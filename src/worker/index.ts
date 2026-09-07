import 'dotenv/config';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../lib/db';
import { runJobById } from '../lib/job-runner';
import { firmsDueForSync, syncFirm, AUTO_EVERY_MS } from '../lib/billing-check/sync';
import { FIRMS } from '../lib/firms';
import { getStoredCabinetSession } from '../lib/cabinet/session';
import { ingestCabinetStatuses } from '../lib/cabinet/status-ingest';
import { SessionExpiredError } from '../lib/session-store';
import { autoResumeTick } from '../lib/court-auto-resume';

// Standalone background worker. Runs in its own process (a Docker container in production) and is the
// ONLY executor of the heavy document jobs when the web app runs with JOB_MODE=worker. It polls the
// Job table, atomically claims one PENDING job at a time, and runs it to completion via the shared
// runJobById() — the exact same code path the web process uses inline. Chromium (playwright) lives
// here, off the request server.
//
// Only PACKET/COURT_SUBMIT/OFERTA/TALABNOMA are claimed. IMPORT stays on the web process (it needs the just-
// uploaded temp file in ./uploads); the worker never touches it.
// COURT_SUBMIT bu ro'yxatda EMAS — u o'z siklida ishlaydi (pastda courtSubmitLoop).
// Sabab: sud partiyasi soatlab davom etadi (100 ta ish × ~45s), doc-navbat esa bir vaqtda
// BITTA job bajaradi. 2026-09-07 da operator ZIP so'radi va u sud partiyasi orqasida
// «0/100» bo'lib bir soat kutdi. ZIP/oferta/talabnoma portalga tegmaydi — ular sud
// partiyasini kutishi mantiqsiz.
const DOC_TYPES = ['PACKET', 'OFERTA', 'TALABNOMA', 'TALABNOMA_FORM'] as const;
const POLL_MS = 2000;
// A RUNNING doc-job whose progress hasn't advanced in this long is treated as orphaned (its worker
// died). Job.updatedAt is only bumped once per CONCURRENCY-sized render batch, so this MUST stay well
// above the worst-case gap between those per-batch writes — otherwise a slow-but-live batch under
// chromium contention could be mistaken for a dead worker. Run ONE worker instance (see WORKER.md):
// with a single worker the startup sweep only ever sees genuinely-orphaned jobs (this worker holds
// none yet); a second concurrent instance is the only way a live job could be wrongly failed, and the
// Docker service pins container_name so an accidental `--scale worker=2` errors out.
const STALE_MS = 15 * 60_000;

let stopping = false;

// Atomically claim the oldest PENDING doc-job: flip PENDING→RUNNING and only proceed if THIS update
// won the row (count === 1). Guards against two workers grabbing the same job.
async function claimNext(): Promise<number | null> {
  const job = await prisma.job.findFirst({
    where: { status: 'PENDING', type: { in: DOC_TYPES as unknown as string[] } },
    // FIX 2 (queue priority): smallest job first (total = doc count), then oldest. A quick interactive
    // single-case download (total 1) must not wait behind a huge bulk batch (total ~1671) queued just
    // before it — that starvation is what times out the route's awaitJob. Ties break by createdAt (FIFO).
    // NB: a bulk job ALREADY RUNNING can't be preempted; this only reorders what's still PENDING.
    orderBy: [{ total: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!job) return null;
  const claimed = await prisma.job.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'RUNNING' } });
  return claimed.count > 0 ? job.id : null; // lost the race → caller retries next tick
}

/**
 * ZIP/hujjat job'i worker bilan birga o'ladi — startda uni DARHOL hal qilamiz.
 *
 * MUAMMO (2026-09-07, operator: «zip 0/100 deyabdi»): worker qayta ishga tushdi va PACKET
 * job #224 bazada RUNNING 24/100 bo'lib qoldi. Uni hech kim davom ettirmadi va hech kim
 * yiqilgan deb ham belgilamadi: `failStaleOrphans` faqat updatedAt STALE_MS (15 daqiqa)
 * dan eski job'ni oladi, bu esa endigina uzilgan job uchun to'g'ri kelmaydi. Natijada
 * operator ~20 daqiqa qimirlamaydigan «24/100» ga qarab o'tirdi, keyin job jimgina
 * FAILED bo'ldi va ZIP butunlay yo'qoldi.
 *
 * Worker BITTA nusxada ishlaydi (compose'da container_name pinlangan), ya'ni worker
 * endigina ko'tarilgan paytda RUNNING turgan hujjat job'i TIRIK BO'LISHI MUMKIN EMAS.
 * Shuning uchun:
 *   • yarim yozilgan arxiv o'chiriladi (37 MB chala ZIP diskda qolib ketgandi);
 *   • job PENDING'ga qaytariladi va o'zi qaytadan boshlanadi — ZIP faqat qayta render,
 *     u tashqi tizimga hech narsa yubormaydi, shuning uchun takrorlash xavfsiz;
 *   • lekin CHEKSIZ emas: job worker'ni ikki marta yiqitgan bo'lsa (yoki deploy ketma-ket
 *     kelsa) uchinchisida FAILED bo'ladi. Aks holda «har startda 616 ta mijozni qaytadan
 *     render qilish» tsikliga tushib qolish mumkin.
 */
const MAX_AUTO_RESTARTS = 2;
const EXPORTS_DIR = path.join(process.cwd(), 'exports');

async function resumeInterruptedDocJobs(): Promise<void> {
  const jobs = await prisma.job.findMany({
    where: { status: 'RUNNING', type: { in: DOC_TYPES as unknown as string[] } },
    select: { id: true, type: true, progress: true, total: true, params: true },
  });
  if (jobs.length === 0) return;
  let resumed = 0;
  let failed = 0;
  for (const j of jobs) {
    // Chala arxiv — bu job qaytadan boshlanadi yoki yiqiladi; ikkala holatda ham u keraksiz.
    await fsp.rm(path.join(EXPORTS_DIR, `${j.id}.zip`), { force: true }).catch(() => {});
    const p = (j.params ?? {}) as Record<string, unknown>;
    const tries = Number(p.autoRestarts ?? 0);
    if (tries >= MAX_AUTO_RESTARTS) {
      await prisma.job.update({
        where: { id: j.id },
        data: {
          status: 'FAILED',
          message: `Uzilib qoldi (${j.progress}/${j.total}) va ${MAX_AUTO_RESTARTS} marta avtomatik qayta boshlangan — to'xtatildi. Qaytadan bosing.`,
        },
      });
      failed++;
    } else {
      await prisma.job.update({
        where: { id: j.id },
        data: {
          status: 'PENDING',
          progress: 0,
          resultPath: null,
          message: `Uzilib qoldi (${j.progress}/${j.total}) — avtomatik qaytadan boshlanmoqda.`,
          params: { ...p, autoRestarts: tries + 1 },
        },
      });
      resumed++;
    }
  }
  console.log(`[worker] uzilgan hujjat job'lari: ${resumed} ta qaytadan boshlanadi, ${failed} ta to'xtatildi`);
}

/**
 * Har qanday turdagi ABADIY «RUNNING» job'ni yopish.
 *
 * `failStaleOrphans` faqat worker o'zi bajaradigan turlarni ko'radi. Web jarayonida inline
 * ketadigan turlar (MIB_RUN va h.k.) esa jarayon o'lsa MANGU RUNNING bo'lib qoladi:
 * 2026-09-07 da bazada 17 KUN oldingi 6 ta MIB_RUN «ketyapti» bo'lib turgan edi va
 * jurnalда ish hamon davom etayotgandek ko'rinardi.
 *
 * Chegara ataylab juda katta (6 soat): bu yerda maqsad tirik ishni to'xtatish emas, faqat
 * aniq o'lganini yopish. Hech bir job 6 soat davom etmaydi.
 */
const DEAD_MS = 6 * 60 * 60_000;

async function failLongDeadJobs(): Promise<void> {
  const res = await prisma.job.updateMany({
    where: { status: 'RUNNING', updatedAt: { lt: new Date(Date.now() - DEAD_MS) } },
    data: { status: 'FAILED', message: 'Jarayon uzilgan — bu job tugamagan holda qolib ketgan.' },
  });
  if (res.count > 0) console.log(`[worker] ${res.count} ta abadiy «ketyapti» job yopildi`);
}

// One-time, at startup: a doc-job left RUNNING with no fresh progress (updatedAt older than STALE_MS)
// has no live worker — it was orphaned by a crashed/killed worker or an old inline run the dev server
// abandoned. Mark it FAILED (not PENDING): these jobs restart from scratch anyway, and silently
// re-running a huge abandoned batch (e.g. a 1671-case packet) on every worker start is surprising and
// expensive. The user re-triggers from the UI if they still want the output. A genuinely in-flight job
// updates its progress per batch, so it is never this stale and is left alone.
async function failStaleOrphans(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const res = await prisma.job.updateMany({
    where: { status: 'RUNNING', type: { in: DOC_TYPES as unknown as string[] }, updatedAt: { lt: cutoff } },
    data: { status: 'FAILED', message: 'Ishchi jarayon uzilgan — bu job yarim yoʻlda toʻxtagan. Qayta ishga tushiring.' },
  });
  if (res.count > 0) console.log(`[worker] marked ${res.count} orphaned RUNNING job(s) FAILED`);
}

/**
 * Sudga yuborish partiyasi worker qayta ishga tushganda TIRIK QOLMAYDI — uni davom ettirish
 * mantig'i yo'q, jarayon o'lgach ish shunchaki to'xtaydi. Umumiy orphan sweep esa 15 daqiqa
 * kutadi (STALE_MS), ya'ni shu vaqt davomida UI «Yuborilmoqda» deb YOLG'ON ko'rsatib turadi
 * va operator kutib o'tiraveradi (2026-09-07: deploy partiyani uzdi, job 15 daqiqa RUNNING
 * bo'lib qoldi).
 *
 * Shuning uchun startda COURT_SUBMIT joblari DARHOL yakunlanadi. Ishlarning o'zi yo'qolmaydi:
 * CourtQueueItem'dagi PENDING qatorlar joyida qoladi va operator qayta bosganda aynan shu
 * joydan davom etadi (caseId unique — takror yuborilmaydi). RUNNING qolgan bitta ish ham
 * PENDING'ga qaytariladi: uning taqdiri nomaʼlum, lekin idempotentlik uni himoya qiladi.
 */
async function resetInterruptedCourtJobs(): Promise<void> {
  // 1) Kunlik limitni MOSLASHTIRISH — jobdan mustaqil.
  //
  // `consumeCourtSend` partiya boshlanishida har bir ishga courtSentAt yozadi (limit sanog'i).
  // Ish yuborilmasa bu yozuv qolib ketadi va sud limiti «to'lib» ko'rinadi: 2026-09-07 da
  // Uchtepa «101/200 ishlatilgan» deb turdi, aslida atigi 2 ta ish ketgan edi.
  //
  // Shuning uchun har startda solishtiramiz: navbatda TUGAMAGAN (PENDING/FAILED) va bosqichi
  // sudda BO'LMAGAN ishlarning courtSentAt'i tozalanadi. Haqiqatan yuborilganlar (DONE yoki
  // stage=COURT_SUBMITTED) tegilmaydi — ular limitni haqli ravishda band qiladi.
  const stale = await prisma.courtQueueItem.findMany({
    where: {
      state: { in: ['PENDING', 'FAILED'] },
      case: { courtSentAt: { not: null }, stage: { not: 'COURT_SUBMITTED' } },
    },
    select: { caseId: true },
  });
  if (stale.length) {
    await prisma.arizaCase.updateMany({ where: { id: { in: stale.map((x) => x.caseId) } }, data: { courtSentAt: null } });
    console.log(`[worker] ${stale.length} ta yuborilmagan ishning kunlik limiti bo'shatildi`);
  }

  // 2) OSILIB QOLGAN «RUNNING» NAVBAT YOZUVLARI — jobdan MUSTAQIL.
  //
  // Sudga yuborish partiyasi jarayon bilan birga o'ladi, ya'ni worker endigina ishga
  // tushgan paytda birorta ish HAQIQATAN «ketayotgan» bo'lishi mumkin emas. Ilgari bu
  // tozalash `jobs.length === 0` sharti ortida edi: job allaqachon FAILED bo'lib, faqat
  // navbat yozuvi RUNNING bo'lib qolgan holatda u UMUMAN ishlamasdi. Natijada sahifa
  // yashil puls bilan «Yuborilmoqda» deb turar, ish esa hech qachon davom etmasdi —
  // `resume` faqat PENDING yozuvlarni oladi, ya'ni o'sha ish navbatdan tushib qolardi.
  //
  // LEKIN HAMMASINI EMAS. Ish `save-suit` dan O'TIB, `send-to-court` da uzilgan bo'lishi
  // mumkin — bunda ADOLAT'da da'vo ALLAQACHON yaratilgan. Uni «navbatda» deb qaytarish
  // AYNI ODAMGA IKKINCHI da'vo ochadi, ya'ni qaytarib bo'lmaydigan zarar. Shuning uchun
  // faqat portalda IZI YO'Q ishlar qaytariladi: sud ish raqami ham, `courtCaseId` ham
  // yozilmagan. Izi borlari FAILED bo'lib qoladi va operator ularni qo'lda tekshiradi.
  const risky = await prisma.courtQueueItem.findMany({
    where: {
      state: 'RUNNING',
      OR: [{ caseNumber: { not: null } }, { case: { courtCaseId: { not: null } } }],
    },
    select: { id: true, caseId: true },
  });
  if (risky.length) {
    await prisma.courtQueueItem.updateMany({
      where: { id: { in: risky.map((r) => r.id) } },
      data: {
        state: 'FAILED',
        step: null,
        lastError: 'Worker uzilganda ADOLAT\'da ish allaqachon yaratilgan edi — qayta yuborilmaydi '
          + '(ikkinchi da\'vo xavfi). Portalda holatini qo\'lda tekshiring.',
      },
    });
    console.warn(`[worker] ${risky.length} ta uzilgan ish ADOLAT'da izi borligi uchun QAYTA YUBORILMAYDI (case: ${risky.map((r) => r.caseId).join(', ')})`);
  }
  const zombie = await prisma.courtQueueItem.updateMany({
    where: { state: 'RUNNING' },
    data: { state: 'PENDING', step: null },
  });
  if (zombie.count > 0) {
    console.log(`[worker] ${zombie.count} ta osilib qolgan «ketyapti» yozuvi navbatga qaytarildi`);
  }

  const jobs = await prisma.job.findMany({ where: { status: 'RUNNING', type: 'COURT_SUBMIT' }, select: { id: true, progress: true, total: true } });
  if (jobs.length === 0) return;
  for (const j of jobs) {
    await prisma.job.update({
      where: { id: j.id },
      data: {
        status: 'FAILED',
        message: `Uzilib qoldi (${j.progress}/${j.total} yuborilgan) — worker qayta ishga tushdi. Qolganini yuborish uchun qaytadan bosing, takrorlanmaydi.`,
      },
    });
  }
  // Kunlik limitni qaytaramiz: partiya boshlanishida har bir ishga courtSentAt yozilgan,
  // lekin ular yuborilmadi. Aks holda sud limiti yuborilmagan ishlar bilan «to'lib» qoladi.
  const stuck = await prisma.courtQueueItem.findMany({
    where: { jobId: { in: jobs.map((j) => j.id) }, state: { in: ['PENDING', 'FAILED'] } },
    select: { caseId: true },
  });
  if (stuck.length) {
    await prisma.arizaCase.updateMany({ where: { id: { in: stuck.map((x) => x.caseId) } }, data: { courtSentAt: null } });
  }
  console.log(`[worker] ${jobs.length} ta uzilgan sud partiyasi yakunlandi, ${stuck.length} ta limit bo'shatildi`);
}

// FIX 4: how often the idle poll loop re-runs the orphan sweep (~5 min). The startup sweep alone misses
// a job left RUNNING by a mid-render restart: at boot it is younger than STALE_MS and thus skipped, and
// nothing rechecks it afterward. Re-sweeping on idle eventually fails it once it ages past STALE_MS.
const ORPHAN_SWEEP_MS = 5 * 60_000;

async function loop(): Promise<void> {
  console.log('[worker] started — polling PENDING PACKET/OFERTA/TALABNOMA jobs every', POLL_MS, 'ms');
  // TARTIB MUHIM: avval endigina uzilganlarni qaytadan boshlaymiz, keyin eski o'liklarni yopamiz.
  await resumeInterruptedDocJobs().catch((e) => console.error('[worker] uzilgan hujjat job\'larini tiklash xatosi', e));
  await failLongDeadJobs().catch((e) => console.error('[worker] eski job sweep xatosi', e));
  await failStaleOrphans().catch((e) => console.error('[worker] orphan sweep failed', e));
  await resetInterruptedCourtJobs().catch((e) => console.error('[worker] sud partiyasini tiklash xatosi', e));
  let lastSweep = Date.now();
  while (!stopping) {
    try {
      const id = await claimNext();
      if (id != null) {
        console.log(`[worker] running job ${id}`);
        const t0 = Date.now();
        await runJobById(id).catch((e) => console.error(`[worker] job ${id} threw`, e));
        console.log(`[worker] job ${id} finished in ${Math.round((Date.now() - t0) / 1000)}s`);
        continue; // immediately look for the next job (no idle wait)
      }
    } catch (e) {
      console.error('[worker] poll error', e);
    }
    // Periodic re-sweep (idle only — a busy worker is inside runJobById above). STALE_MS is unchanged,
    // so a genuinely-live long job (progress bumped per batch) is never mistaken for an orphan.
    if (Date.now() - lastSweep >= ORPHAN_SWEEP_MS) {
      lastSweep = Date.now();
      await failStaleOrphans().catch((e) => console.error('[worker] periodic orphan sweep failed', e));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await prisma.$disconnect().catch(() => {});
  console.log('[worker] stopped');
}

// billing.sud.uz kvitansiyalarini firma bo'yicha AVTOMAT yangilab turadi (AUTO_EVERY_MS, hozir 2 soat) —
// operator hech nima bosmaydi. Doc-job navbatidan MUSTAQIL o'z sikli: worker uzoq PDF paketi
// ustida band bo'lsa ham jadval kechikmaydi (ular boshqa resurslarni ishlatadi — bu yerda faqat
// tarmoq + kichik DB yozuvlari).
//
// Navbat `finishedAt` asosida: firma oxirgi MUVAFFAQIYATLI yakunidan AUTO_EVERY_MS o'tgandagina
// qayta yig'iladi. Shu sabab worker qayta ishga tushaverishi ham billing'ni urib tashlamaydi —
// yaqinda yig'ilgan firma navbatga tushmaydi. Qulf `BillingCheckSync` da, ya'ni qo'lda
// bosilgan yangilanish bilan hech qachon to'qnashmaydi.
const AUTO_CHECK_MS = 5 * 60_000;

async function billingAutoSyncLoop(): Promise<void> {
  console.log(`[worker] billing auto-sync: every ${Math.round(AUTO_EVERY_MS / 60_000)} min per firm`);
  // Ishga tushgach biroz kutamiz — migrate/DB tayyor bo'lsin.
  await new Promise((r) => setTimeout(r, 30_000));
  while (!stopping) {
    try {
      for (const firmCode of await firmsDueForSync()) {
        if (stopping) break;
        const res = await syncFirm(firmCode, 'AUTO');
        // null = qulf band (qo'lda yangilanish ketyapti) — keyingi tsiklda urinamiz.
        if (res) console.log(`[worker] billing auto-sync ${firmCode}: ${res.done}/${res.total}`);
      }
    } catch (e) {
      // syncFirm holatni allaqachon FAILED deb yozgan; bu yerda faqat log.
      console.error('[worker] billing auto-sync error', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, AUTO_CHECK_MS));
  }
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    console.log(`[worker] ${sig} — finishing current job then exiting`);
    stopping = true;
  });
}

// Sudga yuborilgan ishlarning TAQDIRINI kuzatib turadi (qabul qilindi / qaytarildi / qaror).
//
// Nega kerak: ish sudga topshirilgandan keyin uning holati faqat cabinet.sud.uz'da o'zgaradi —
// bizga hech narsa kelmaydi. ingestCabinetStatuses kodi bor edi, lekin uni FAQAT qo'lda
// skriptlar chaqirardi (scripts/sync-all.ts va h.k.), cron ham yo'q edi. Natijada
// ClientCaseStatus jadvali BO'SH turardi va «Qaytganlar» sahifasi hech qachon to'lmasdi:
// yuz-minglab ish yuborilgandan keyin ham nima bo'lganini hech kim bilmasdi.
//
// Yengil: har firma uchun 12 ta ro'yxat so'rovi (CATS × LISTS), case-per-request emas.
// Firmalar orasida pauza bor — portalga bir zumda urilmasin (2026-09-06 blokidan saboq).
const COURT_STATUS_EVERY_MS = 30 * 60_000;
const COURT_STATUS_FIRM_GAP_MS = 15_000;

async function courtStatusSyncLoop(): Promise<void> {
  console.log(`[worker] sud status sync: har ${Math.round(COURT_STATUS_EVERY_MS / 60_000)} daqiqada`);
  await new Promise((r) => setTimeout(r, 90_000)); // migrate/DB tayyor bo'lsin
  while (!stopping) {
    for (const f of FIRMS) {
      if (stopping) break;
      try {
        const s = await getStoredCabinetSession(f.stir);
        const r = await ingestCabinetStatuses(s, f.branchCode);
        if (r.totalCases > 0) {
          console.log(`[worker] sud status ${f.branchCode}: ${r.totalCases} ta ish (mos ${r.matched})`);
        }
      } catch (e) {
        // Sessiya yo'q / portal bloklangan — bu firma shu tsiklda o'tkazib yuboriladi.
        // Xato butun siklni to'xtatmasligi kerak: bitta firmaning sessiyasi tugagani
        // qolganlarining kuzatuvini o'chirmasin.
        const msg = e instanceof SessionExpiredError ? 'sessiya yo\'q' : (e as Error).message?.slice(0, 120);
        if (!(e instanceof SessionExpiredError)) console.error(`[worker] sud status ${f.branchCode}: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, COURT_STATUS_FIRM_GAP_MS));
    }
    await new Promise((r) => setTimeout(r, COURT_STATUS_EVERY_MS));
  }
}

// Navbat portal bloki tufayli to'xtagan bo'lsa — o'zi qayta boshlaydi (5→5→5→30→60→120 daq).
// Operator qo'yган PAUZA va sud kunlik limiti baribir amal qiladi.
async function courtAutoResumeLoop(): Promise<void> {
  console.log('[worker] sud navbati avto-davom: har daqiqada tekshiriladi');
  await new Promise((r) => setTimeout(r, 60_000));
  while (!stopping) {
    try {
      const did = await autoResumeTick();
      if (did) console.log(`[worker] ${did}`);
    } catch (e) {
      console.error('[worker] avto-davom xatosi', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, 60_000));
  }
}

// Sud partiyasi — ALOHIDA sikl. Doc-navbatdan mustaqil: uzoq sud partiyasi ZIP, oferta va
// talabnoma tayyorlashni to'sib qo'ymaydi (ular bir-biriga xalaqit bermaydigan ishlar:
// sud partiyasi tarmoqda kutadi, doc-joblar chromium bilan render qiladi).
async function courtSubmitLoop(): Promise<void> {
  console.log('[worker] sud partiyasi sikli: alohida navbat');
  while (!stopping) {
    try {
      const job = await prisma.job.findFirst({
        where: { status: 'PENDING', type: 'COURT_SUBMIT' },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (job) {
        const claimed = await prisma.job.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'RUNNING' } });
        if (claimed.count > 0) {
          console.log(`[worker] sud partiyasi ${job.id} boshlandi`);
          await runJobById(job.id).catch((e) => console.error(`[worker] sud partiyasi ${job.id} xatosi`, e));
          console.log(`[worker] sud partiyasi ${job.id} tugadi`);
          continue;
        }
      }
    } catch (e) {
      console.error('[worker] sud sikli xatosi', e instanceof Error ? e.message : e);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

void billingAutoSyncLoop().catch((e) => console.error('[worker] billing auto-sync fatal', e));
void courtSubmitLoop().catch((e) => console.error('[worker] sud sikli fatal', e));
void courtAutoResumeLoop().catch((e) => console.error('[worker] avto-davom fatal', e));
void courtStatusSyncLoop().catch((e) => console.error('[worker] sud status sync fatal', e));

loop().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
