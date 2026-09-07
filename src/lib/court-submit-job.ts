// src/lib/court-submit-job.ts
// Web UI orqali («Sudga yuborish» va «Yuborish navbati») ishlarni
// ketma-ketlikda (sequential) va rate-limitni saqlagan holda
// to'g'ridan-to'g'ri cabinet.sud.uz (Adolat) tizimiga kirituvchi orqa fon dvigateli.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma } from './db';
import { getStoredCabinetSession } from './cabinet/session';
import { CabinetSubmitEngine } from '../../cabinet-api-skeleton/submitter';
import { CabinetRequestError } from '../../cabinet-api-skeleton/client';
import { paceCase, backoff, caseGapFor, isQueuePaused, REQUEST_GAP_MS, CASE_GAP_MS } from './cabinet/pacer';
import { audit, AuditAction } from './audit';
import { resolveClaimantId } from './cabinet/claimant';
import { releaseCourtSend } from './court-routing';
import { noteQueueBlocked, resetQueueBackoff } from './court-auto-resume';
import { resolveCabinetCourtGuid, CABINET_REGION_IDS } from '../../cabinet-api-skeleton/constants';
import type { SourceCaseData } from '../../cabinet-api-skeleton/builder';
import type { CaseFileToUpload } from '../../cabinet-api-skeleton/uploader';

// Da'vogar (claimant) GUID endi KODDA emas — Firm.cabinetClaimantId dan o'qiladi va kerak
// bo'lsa portaldan avtomatik aniqlanadi (src/lib/cabinet/claimant.ts). Sabab: har yangi firma
// uchun deploy qilish shart emas, va eng muhimi — jim fallback yo'q.

// Worker jarayonida so'rov konteksti yo'q — currentUser() yiqiladi va audit JIM yozilmay
// qoladi. Shuning uchun aktyor aniq beriladi: navbat tizim nomidan ishlaydi.
const QUEUE_ACTOR = { username: 'tizim (sud navbati)', role: 'system' };

/** Sud ADOLAT'da elektron qabulni yoqmaganini bildiruvchi xato (portal o'zbekcha-kirillcha yozadi). */
const COURT_CLOSED_RE = /канцелярия|kantselyariya/i;

/**
 * Sudning ADOLAT holatini HAQIQIY natijadan yangilaydi.
 *
 * Nega kerak: bu bayroq bir marta qo'lda qo'yilsa, sud muammoni tuzatgach ham abadiy yopiq
 * bo'lib qolardi va operator buni bilmasdi. Endi bayroq o'z-o'zidan boshqariladi:
 *   • «канцелярия ходими киритилмаган» xatosi kelsa → sud yopiq deb belgilanadi;
 *   • o'sha sudga ish MUVAFFAQIYATLI ketsa → qayta ochiladi.
 * Ya'ni holat har safar jonli traffikdan tasdiqlanadi, taxmindan emas.
 */
async function syncCourtCabinetState(courtId: number | null | undefined, ok: boolean, errText?: string) {
  if (!courtId) return;
  try {
    if (ok) {
      await prisma.court.updateMany({
        where: { id: courtId, cabinetEnabled: false },
        data: { cabinetEnabled: true, cabinetNote: null },
      });
    } else if (errText && COURT_CLOSED_RE.test(errText)) {
      await prisma.court.updateMany({
        where: { id: courtId, cabinetEnabled: true },
        data: {
          cabinetEnabled: false,
          cabinetNote: 'ADOLAT’da bu sud uchun kantselyariya xodimi biriktirilmagan — elektron ariza qabul qilinmaydi',
        },
      });
    }
  } catch { /* holat belgisi yordamchi ma'lumot — yozilmasa ish to'xtamasin */ }
}

// Tezlik endi src/lib/cabinet/pacer.ts da — GLOBAL (barcha firma navbatlari uchun bitta) va
// SO'ROV darajasida. Eski DEFAULT_DELAY_MS faqat case'lar orasida 8s kutardi, bitta case
// ichidagi ~7 so'rov esa bir zumda otilardi — aynan shu naqsh 2026-09-06 da bloklangan.

export interface CourtSubmitJobOpts {
  firmId: number;
  snapshotId?: number;
  caseIds: number[];
  /** @deprecated Tezlik endi pacer.ts da global belgilanadi; bu maydon e'tiborga olinmaydi. */
  delayMs?: number;
  dryRun?: boolean;
}

/**
 * Firma hujjatlari HAQIQATAN shu firmaniki ekanini tekshiradi.
 *
 * 2026-09-07 da aniqlangan: URBAN va COMMUNITY'ning ISHONCHNOMA yozuvlari BRIGHT'ning
 * fayliga ishora qilardi — uchala fayl bayt-baytiga bir xil (md5 600b3f16...). Ishonchnoma
 * vakilga AYNAN qaysi kompaniya nomidan ish yuritish huquqini beradi; boshqa firmaniki
 * biriktirilsa vakolat tasdiqlanmaydi va sud da'voni qaytaradi — lekin da'vo rasman
 * berilgan bo'lib qoladi.
 *
 * Shuning uchun: bir firmaning hujjati boshqa firmaning AYNI turdagi hujjati bilan
 * bayt-baytiga bir xil bo'lsa — yuborish to'xtaydi. Job boshida BIR MARTA chaqiriladi
 * (har case uchun emas: 9 firma × 3 hujjat, arzon).
 */
export async function assertFirmDocsBelongToFirm(firmId: number, firmName: string): Promise<void> {
  const KINDS = ['ISHONCHNOMA', 'GUVOHNOMA', 'SHARTNOMA'];
  const all = await prisma.firmDocument.findMany({
    where: { kind: { in: KINDS as any } },
    select: { firmId: true, kind: true, filePath: true, firm: { select: { shortName: true } } },
  });

  const hashOf = async (p: string): Promise<string | null> => {
    try {
      let f = p;
      if (f.startsWith('/app/')) f = path.join(process.cwd(), f.replace(/^\/app\//, ''));
      return createHash('sha256').update(await fs.readFile(f)).digest('hex');
    } catch { return null; }
  };

  // ISHONCHNOMA ataylab umumiy: guruhda vakolatnoma BRIGHT nomidan rasmiylashtirilgan va
  // barcha firmalar uchun bir xil hujjat ishlatiladi (operator 2026-09-07 da tasdiqladi).
  // Shuning uchun u faqat OGOHLANTIRISH beradi — ishni to'xtatmaydi.
  // GUVOHNOMA (davlat ro'yxatidan o'tganlik) va SHARTNOMA esa har firmada O'ZINIKI bo'lishi
  // shart — boshqa firmanikini yuborish da'voni asossiz qiladi, shuning uchun ular TO'SADI.
  const WARN_ONLY = new Set(['ISHONCHNOMA']);

  const mine = all.filter((d) => d.firmId === firmId);
  for (const doc of mine) {
    const h = await hashOf(doc.filePath);
    if (!h) continue;
    for (const other of all) {
      if (other.firmId === firmId || other.kind !== doc.kind) continue;
      if ((await hashOf(other.filePath)) !== h) continue;
      const who = other.firm?.shortName ?? 'boshqa firma';
      if (WARN_ONLY.has(String(doc.kind))) {
        console.warn(`⚠ ${firmName}: «${doc.kind}» ${who}'niki bilan bir xil fayl (ataylab umumiy deb belgilangan).`);
        continue;
      }
      throw new Error(
        `${firmName} uchun «${doc.kind}» hujjati ${who}'niki bilan AYNAN bir xil fayl. ` +
        `Bu hujjat ${firmName} nomidan vakolat bermaydi — sud da'voni qaytaradi. ` +
        `Firmalar → ${firmName} → «Hujjatlar»dan to'g'ri faylni yuklang.`,
      );
    }
  }
}

/**
 * Har bir ish uchun diskdagi hujjatlarni yig'ish
 */
export async function collectCaseFiles(ac: any): Promise<CaseFileToUpload[]> {
  const filesToUpload: CaseFileToUpload[] = [];

  // A) DB dagi CaseDocument yozuvlaridan
  for (const doc of ac.documents || []) {
    try {
      let fPath = doc.filePath;
      if (fPath.startsWith('/app/')) {
        fPath = path.join(process.cwd(), fPath.replace(/^\/app\//, ''));
      }
      const buf = await fs.readFile(fPath);
      let kind: CaseFileToUpload['kind'] = 'OFERTA';
      if (doc.kind === 'SIGNED_ARIZA' || doc.kind === 'ARIZA') kind = 'ARIZA';
      else if (doc.kind === 'TALABNOMA') kind = 'TALABNOMA';
      else if (doc.kind === 'TALABNOMA_RECEIPT') kind = 'TALABNOMA_CHECK';
      else if (doc.kind === 'GUVOHNOMA') kind = 'GUVOHNOMA';
      else if (doc.kind === 'ISHONCHNOMA') kind = 'ISHONCHNOMA';

      // TAKRORNI TO'SISH: CaseDocument.kind da unique cheklov yo'q, shuning uchun bitta
      // hujjat (masalan Talabnoma kvitansiyasi) ikki qatorda turishi mumkin — 2026-09-06
      // sinovida aynan shunday bo'ldi va sudga bir xil fayl 2 marta ketardi.
      if (filesToUpload.some((f) => f.fileName === doc.fileName && f.kind === kind)) continue;
      filesToUpload.push({ kind, fileName: doc.fileName, buffer: buf });
    } catch {}
  }

  // B) Diskdagi papkalardan qidirish (Oferta va boshqa ilovalar)
  const home = process.env.HOME || '';
  if (ac.clientName) {
    const candidateDirs = [
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 3', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', 'BRIGHT FUTURE FINANCING 2', `${ac.clientName} ${ac.pinfl}`),
      path.join(home, 'Downloads', '5-sud BRIGHT TAYYOR', ac.clientName),
    ];
    for (const cDir of candidateDirs) {
      try {
        const list = await fs.readdir(cDir);
        for (const fname of list) {
          if (!fname.endsWith('.pdf')) continue;
          if (filesToUpload.some((f) => f.fileName === fname)) continue;
          const buf = await fs.readFile(path.join(cDir, fname));
          let kind: CaseFileToUpload['kind'] = 'OFERTA';
          if (/ariza/i.test(fname)) kind = 'ARIZA';
          else if (/talabnoma/i.test(fname)) kind = 'TALABNOMA';
          else if (/receipt|check|td/i.test(fname)) kind = 'TALABNOMA_CHECK';
          else if (/guvox/i.test(fname)) kind = 'GUVOHNOMA';
          else if (/ishonch/i.test(fname)) kind = 'ISHONCHNOMA';
          filesToUpload.push({ kind, fileName: fname, buffer: buf });
        }
        if (filesToUpload.length > 1) break;
      } catch {}
    }
  }

  // C) Firma hujjatlari (guvohnoma / ishonchnoma / shartnoma) — BAZADAN.
  //
  // Avval bu yerda fayl nomlari QO'LDA taxmin qilinardi:
  //   exports/firm-docs/<firmId>/GUVOHNOMA-Guvoxnoma_BRIGHT.pdf
  // Haqiqiy fayl esa vaqt tamg'asi bilan saqlanadi:
  //   exports/firm-docs/1/GUVOHNOMA-1788592171459-Guvoxnoma_BRIGHT.pdf
  // Ya'ni MOS KELMASDI va guvohnoma ham, ishonchnoma ham hech qachon yuklanmasdi —
  // sudga faqat ariza + kvitansiya ketardi. Shartnoma esa umuman qidirilmasdi.
  // Qarz undirish da'vosini shartnomasiz/ishonchnomasiz berish — sud qaytarishining
  // eng keng tarqalgan sababi. Endi yo'llar FirmDocument jadvalidan olinadi.
  const FIRM_DOC_KIND: Record<string, CaseFileToUpload['kind']> = {
    GUVOHNOMA: 'GUVOHNOMA',
    ISHONCHNOMA: 'ISHONCHNOMA',
    SHARTNOMA: 'SHARTNOMA',
  };
  const firmDocs = await prisma.firmDocument.findMany({
    where: { firmId: ac.firmId },
    select: { kind: true, filePath: true },
    orderBy: { sortOrder: 'asc' },
  });
  for (const fd of firmDocs) {
    const kind = FIRM_DOC_KIND[String(fd.kind)];
    if (!kind) continue;
    if (filesToUpload.some((f) => f.kind === kind)) continue; // allaqachon bor
    try {
      let p = fd.filePath;
      if (p.startsWith('/app/')) p = path.join(process.cwd(), p.replace(/^\/app\//, ''));
      const buf = await fs.readFile(p);
      filesToUpload.push({ kind, fileName: path.basename(p), buffer: buf });
    } catch {
      // Fayl diskda yo'q — jim o'tkazib yuborilmaydi: yuqori qatlam (prepare-ready)
      // firma hujjatlari to'liqligini alohida tekshiradi va yetishmasa yubormaydi.
    }
  }

  // D) OFERTA (mikroqarz shartnomasi) — har kredit uchun bittadan, generatsiya qilinadi.
  //
  // NEGA MUHIM: bizning da'vo toifasi 111 — «yozma bitimga asoslangan talab». Oferta aynan
  // o'sha YOZMA BITIM, ya'ni da'voning huquqiy asosi. Usiz da'vo — asossiz da'vo.
  //
  // Bu ZIP paketda (buildCasePacket) ANCHADAN BERI bor edi, lekin API orqali yuborishda
  // yo'q edi: ikki yo'l vaqt o'tib bir-biridan uzoqlashib ketgan. Ya'ni qo'lda ZIP olib
  // topshirilgan ish to'liq, tizim orqali yuborilgani esa shartnomasiz ketardi.
  //
  // Chromium worker konteynerida bor; bo'lmasa oferta yaratilmaydi va yuqoridagi
  // to'liqlik tekshiruvi ishni to'xtatadi — chala paket sudga ketmaydi.
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true });
    try {
      const { buildCaseOfertas } = await import('./konveyer-packet');
      const res = await buildCaseOfertas(ac.id, browser);
      for (const f of res?.files ?? []) {
        if (filesToUpload.some((x) => x.fileName === f.name)) continue;
        filesToUpload.push({ kind: 'OFERTA', fileName: f.name, buffer: f.buf });
      }

      // E) TALABNOMANING O'ZI (qarzni to'lash haqidagi talab xati).
      //
      // Hozirgacha sudga faqat uning YETKAZILGANLIK KVITANSIYASI (TALABNOMA_CHECK) ketardi —
      // ya'ni «xat yuborilgani» isboti bor edi, lekin XATNING O'ZI yo'q edi. Sud uchun ikkisi
      // ham kerak: da'vodan oldin qarzdorga talab qo'yilganini ko'rsatish uchun xatning
      // MAZMUNI (qancha, qaysi shartnoma bo'yicha, qachongacha) muhim.
      // ZIP paketda bu hujjat bor edi (buildCasePacket 1-bo'lim) — API oqimida yo'q edi.
      if (!filesToUpload.some((f) => f.kind === 'TALABNOMA')) {
        try {
          const [{ buildTalabnomaRows }, { renderTalabnomaPdf }] = await Promise.all([
            import('./hippo/talabnoma-excel'),
            import('./hippo/talabnoma-pdf'),
          ]);
          const [snap, firm, loans] = await Promise.all([
            ac.snapshotId ? prisma.snapshot.findUnique({ where: { id: ac.snapshotId }, select: { reportDate: true } }) : null,
            ac.kod ? prisma.firm.findUnique({ where: { code: ac.kod } }) : null,
            prisma.loan.findMany({
              where: { snapshotId: ac.snapshotId ?? undefined, pinfl: ac.pinfl, ...(ac.kod ? { branchCode: ac.kod } : {}) },
              orderBy: { id: 'asc' },
            }),
          ]);
          const rows = buildTalabnomaRows(loans as any, snap?.reportDate ?? new Date());
          if (rows.length) {
            const buf = await renderTalabnomaPdf(rows[0], browser, firm ?? undefined);
            filesToUpload.push({
              kind: 'TALABNOMA',
              fileName: `Talabnoma_${(ac.clientName || ac.pinfl || ac.id).toString().replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
              buffer: buf,
            });
          }
        } catch (e) {
          console.error(`[court-submit] Case #${ac.id}: talabnoma PDF yaratilmadi —`, e instanceof Error ? e.message : e);
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    console.error(`[court-submit] Case #${ac.id}: oferta/talabnoma yaratilmadi —`, e instanceof Error ? e.message : e);
  }

  // E) Boji kvitansiyasi (billing.sud.uz invoice PDF).
  //
  // ADOLAT'da bunga alohida hujjat turi bor: «Почта харажати тўланганлиги тўғрисида
  // маълумотнома» (CABINET_DOC_TYPES.POCHTA_XARAJATI_KVITANSIYA).
  //
  // ESLATMA: ZIP paketda bu ATAYIN yo'q (konveyer-packet.ts izohi: raqam arizaning ichida
  // ketadi, PDF esa kerak emas). Sudga API orqali yuborishda esa operator qarori bo'yicha
  // BIRIKTIRILADI — ikkala yo'l bu nuqtada ataylab farq qiladi.
  if (ac.invoiceNo || ac.receiptNumber) {
    const rec = await prisma.invoiceRecord.findFirst({
      where: {
        OR: [
          { caseId: ac.id },
          { invoiceNo: String(ac.invoiceNo ?? ac.receiptNumber) },
        ],
        pdfPath: { not: null },
      },
      select: { invoiceNo: true, pdfPath: true },
      orderBy: { id: 'desc' },
    });
    if (rec?.pdfPath) {
      try {
        let p = rec.pdfPath;
        if (p.startsWith('/app/')) p = path.join(process.cwd(), p.replace(/^\/app\//, ''));
        else if (!path.isAbsolute(p)) p = path.join(process.cwd(), p);
        const buf = await fs.readFile(p);
        filesToUpload.push({ kind: 'BOJI_RECEIPT', fileName: `Kvitansiya_${rec.invoiceNo}.pdf`, buffer: buf });
      } catch (e) {
        console.error(`[court-submit] Case #${ac.id}: boji kvitansiyasi o'qilmadi (${rec.pdfPath})`, e instanceof Error ? e.message : e);
      }
    }
  }

  return filesToUpload;
}

/**
 * 100 talab ishlarni ketma-ketlikda cabinet.sud.uz ga kiritish fon xizmati
 */
export async function runCourtSubmitJob(jobId: number, opts: CourtSubmitJobOpts): Promise<void> {
  await prisma.job.updateMany({ where: { id: jobId }, data: { status: 'RUNNING' } });

  const isDryRun = opts.dryRun === true;

  try {
    const firm = await prisma.firm.findUnique({
      where: { id: opts.firmId },
      select: { id: true, shortName: true, stir: true, cabinetClaimantId: true },
    });
    if (!firm) {
      throw new Error(`Firma topilmadi: id=${opts.firmId}`);
    }

    const firmStir = (firm.stir || '').replace(/\D/g, '');
    if (!firmStir) {
      throw new Error(`Firmada STIR yo'q: ${firm.shortName}`);
    }

    // Cabinet sessiyasini olish
    const sess = await getStoredCabinetSession(firmStir);
    const sessionToken = process.env.CABINET_TOKEN || sess.token;

    // Da'vogar: bazadan; bo'lmasa portaldagi qoralamalardan avtomatik aniqlanib saqlanadi;
    // u ham bo'lmasa ClaimantUnknownError — taxmin qilib yubormaymiz.
    const claimantId = await resolveClaimantId(firm, sess);

    // Firma hujjatlari haqiqatan SHU firmaniki ekanini job boshida bir marta tekshiramiz.
    // Boshqa firmaning ishonchnomasi bilan ketgan da'vo qaytariladi — lekin rasman berilgan
    // bo'lib qoladi, shuning uchun partiya umuman boshlanmasin.
    await assertFirmDocsBelongToFirm(firm.id, firm.shortName);

    // OSILIB QOLGAN KUNLIK LIMITNI QAYTARISH (o'z-o'zini tuzatish).
    //
    // `consumeCourtSend` limitni partiya boshlanishida band qiladi (courtSentAt) va job
    // OXIRIDA yuborilmaganlarini qaytaradi. Lekin worker o'rtada o'lsa (deploy/restart) o'sha
    // yakuniy blok umuman ishlamaydi va joylar abadiy band bo'lib qoladi. 2026-09-07 da
    // shunday bo'ldi: Yuqorichirchiqda 100/1000 band ko'rinardi, holbuki o'sha sudga
    // BITTA ham da'vo ketmagan (u ADOLAT'da yopiq), Uchtepada esa 101 banddan atigi 32 tasi
    // haqiqiy edi.
    //
    // Shuning uchun har partiya boshida: sudga TOPSHIRILMAGAN (stage sudda emas, courtCaseId
    // yo'q), lekin limitni band qilib turgan ishlarning belgisini tozalaymiz. Haqiqatan
    // topshirilganlarga TEGILMAYDI.
    const released = await prisma.arizaCase.updateMany({
      where: {
        firmId: firm.id,
        courtSentAt: { not: null },
        courtCaseId: null,
        stage: { notIn: ['COURT_SUBMITTED', 'COURT_ACCEPTED', 'MIB_SUBMITTED', 'CLOSED'] },
      },
      data: { courtSentAt: null },
    });
    if (released.count) {
      console.log(`[Job ${jobId}] ${released.count} ta osilib qolgan kunlik limit joyi bo'shatildi.`);
    }

    const engine = new CabinetSubmitEngine({
      token: sessionToken,
      account: firmStir,
      orgName: firm.shortName,
    });

    // IDEMPOTENTLIK: allaqachon DONE bo'lgan case qayta yuborilmaydi. Bitta odamga ikkita
    // da'vo ochilishi — qaytarib bo'lmaydigan xato, shuning uchun bu filtr eng muhimi.
    const already = await prisma.courtQueueItem.findMany({
      where: { caseId: { in: opts.caseIds }, state: 'DONE' },
      select: { caseId: true },
    });
    const doneIds = new Set(already.map((q) => q.caseId));
    const pendingIds = opts.caseIds.filter((id) => !doneIds.has(id));
    if (doneIds.size > 0) {
      console.log(`[Job ${jobId}] ${doneIds.size} ta ish allaqachon yuborilgan — o'tkazib yuborildi.`);
    }

    const targetCases = await prisma.arizaCase.findMany({
      where: { id: { in: pendingIds } },
      include: { firm: true, court: true, documents: true },
      orderBy: { id: 'asc' },
    });

    // Navbat yozuvlarini tayyorlash: har case PENDING holatida ko'rinadi (operator darhol
    // "navbatda" deb ko'radi, ish boshlanishini kutmasdan).
    for (const ac of targetCases) {
      await prisma.courtQueueItem.upsert({
        where: { caseId: ac.id },
        create: { caseId: ac.id, firmId: firm.id, account: firmStir, state: 'PENDING', jobId },
        update: { state: 'PENDING', jobId, lastError: null, finishedAt: null },
      });
    }

    console.log(`[Job ${jobId}] Sudga topshirish boshlandi: ${targetCases.length} ta ish (${firm.shortName})`);
    console.log(`[Job ${jobId}] Tezlik: har so'rov orasida ${REQUEST_GAP_MS / 1000}s, ishlar orasida sud sozlamasi bo'yicha (default ${CASE_GAP_MS / 1000}s)`);

    let okCount = 0;
    let failCount = 0;
    // Ketma-ket portal nosozliklari — shu songa yetganda navbat to'xtaydi (haqiqiy blok belgisi).
    let consecutiveBlocked = 0;
    const MAX_CONSECUTIVE_BLOCKED = 3;
    let stopReason: string | null = null;

    for (let idx = 0; idx < targetCases.length; idx++) {
      // Bekor qilish talabini tekshirish
      const curJob = await prisma.job.findUnique({ where: { id: jobId }, select: { cancelRequested: true } });
      if (curJob?.cancelRequested) {
        console.log(`[Job ${jobId}] Operator tomonidan bekor qilindi.`);
        stopReason = 'Operator bekor qildi';
        break;
      }

      // UMUMIY PAUZA: barcha firmalarga taalluqli. Ishlar PENDING bo'lib qoladi — davom
      // ettirilganda aynan shu joydan ketadi, hech narsa takrorlanmaydi.
      if (await isQueuePaused()) {
        console.log(`[Job ${jobId}] Jarayon pauzada — to'xtatildi.`);
        stopReason = 'Pauza — operator jarayonni to\'xtatib qo\'ygan';
        break;
      }

      const ac = targetCases[idx];
      const caseIndexStr = `[${idx + 1}/${targetCases.length}]`;

      // TEZLIK: interval SHU ISHNING SUDI yozuvidan olinadi (Sudlar bo'limida sozlanadi,
      // default 60s). Birinchi ish kutmaydi — pacer oxirgi ish vaqtidan hisoblaydi.
      const gapMs = caseGapFor((ac.court as { sendIntervalSec?: number } | null)?.sendIntervalSec);
      await paceCase(gapMs, (msLeft) => {
        const sec = Math.ceil(msLeft / 1000);
        console.log(`[Job ${jobId}] ${caseIndexStr} navbat: ${sec}s kutilmoqda...`);
        // Kutishni UI'ga ham chiqaramiz — aks holda progress 60 soniya qotib qolgandek
        // ko'rinadi va operator «osilib qoldi» deb o'ylaydi. Job yozuvi ayni paytda
        // worker'ning «tirikman» belgisi ham (orphan sweep updatedAt'ga qaraydi).
        void prisma.job.update({
          where: { id: jobId },
          data: { message: `${okCount} ta yuborildi, ${failCount} ta xato — keyingisi ${sec}s dan keyin` },
        }).catch(() => { /* progress yozuvi muhim emas, ish to'xtamasin */ });
      });

      console.log(`[Job ${jobId}] ${caseIndexStr} Case #${ac.id} (${ac.clientName}) yuborilmoqda...`);
      await prisma.courtQueueItem.update({
        where: { caseId: ac.id },
        data: { state: 'RUNNING', startedAt: new Date(), attempts: { increment: 1 } },
      });

      // Sud GUID. Sud tanilmasa (yoki umuman belgilanmagan bo'lsa) resolveCabinetCourtGuid
      // xato tashlaydi — bu FAQAT shu ishni yiqitishi kerak, butun partiyani emas.
      let courtGuid: string;
      try {
        courtGuid = resolveCabinetCourtGuid(ac.court);
      } catch (e: any) {
        failCount++;
        const msg = String(e?.message || e);
        console.error(`❌ [Job ${jobId}] Case #${ac.id} sud aniqlanmadi: ${msg}`);
        await prisma.courtQueueItem.update({
          where: { caseId: ac.id },
          data: { state: 'FAILED', finishedAt: new Date(), lastError: msg.slice(0, 2000) },
        });
        await audit(AuditAction.COURT_SUBMIT, {
          actor: QUEUE_ACTOR,
          target: `case:${ac.id}`,
          detail: { natija: 'YUBORILMADI', firma: firm.shortName, mijoz: ac.clientName, xato: msg.slice(0, 500), jobId },
        });
        continue;
      }

      // Kreditlar
      let loans = await prisma.loan.findMany({
        where: { snapshotId: ac.snapshotId ?? undefined, pinfl: ac.pinfl, branchCode: ac.kod ?? undefined },
      });
      if (loans.length === 0) {
        loans = await prisma.loan.findMany({ where: { pinfl: ac.pinfl, branchCode: ac.kod ?? undefined } });
      }
      if (loans.length === 0) {
        loans = await prisma.loan.findMany({ where: { pinfl: ac.pinfl } });
      }

      const principal = loans.reduce((s, l) => s + Number(l.debtPrincipal || 0) + Number(l.debtOverduePrincipal || 0), 0);
      const interest = loans.reduce((s, l) => s + Number(l.debtTermInterest || 0) + Number(l.debtOverdueInterest || 0), 0);
      const total = Number(ac.totalDebt) || (principal + interest);

      const firstLoan = loans[0];
      const rawLoan = (firstLoan?.raw && typeof firstLoan.raw === 'object' ? firstLoan.raw : {}) as Record<string, any>;
      const passportSn: string = firstLoan?.passportSn || rawLoan['Паспорт'] || '';
      const passportClean = passportSn.replace(/\s+/g, '').toUpperCase();

      const caseData: SourceCaseData = {
        courtId: courtGuid,
        regionId: CABINET_REGION_IDS.TOSHKENT_VILOYATI,
        claimantId,
        receiptNumber: ac.receiptNumber ?? null,
        firm: { stir: firmStir },
        debtor: {
          pinfl: ac.pinfl || '',
          fullName: ac.clientName || '',
          passportSerial: passportClean.slice(0, 2) || undefined,
          passportNumber: passportClean.slice(2) || undefined,
          phone: firstLoan?.phone || undefined,
          gender: undefined,
          address: firstLoan?.postAddressUz || firstLoan?.postAddress || undefined,
        },
        debt: {
          principal, interest, penalty: 0, fine: 0,
          moralDamage: 0, materialDamage: 0, lostProfit: 0, prepaidExpense: 0,
          total,
        },
      };

      try {
        const filesToUpload = await collectCaseFiles(ac);

        // ISH DARAJASIDA QAYTA URINISH.
        //
        // Portal vaqti-vaqti bilan 500/502 beradi (2026-09-07: 96 tadan 3 tasi «Fayl
        // yuklashda xatolik [500]» bo'ldi). Bu ishning ma'lumotiga aloqasi yo'q — portal
        // o'zi qoqilgan. Avval bunday ish darrov «Yuborilmadi» bo'lib qolar va operator
        // uni qo'lda qayta yuborishi kerak edi. Endi o'sha zahoti 2 marta qayta uriniladi.
        //
        // FAQAT vaqtinchalik xatolarda: ma'lumot nosoz bo'lsa (400 — arizasiz, kvitansiya
        // to'lanmagan) qayta urinish behuda va zararli, u darrov FAILED bo'ladi.
        //
        // Eslatma: qayta urinishda YANGI qoralama yaratiladi (oldingisi ADOLAT'da yetim
        // qoladi). Bu ataylab: yetim qoralama zararsiz, yuborilmagan da'vo esa yo'qotish.
        const CASE_TRIES = 3;
        let result!: Awaited<ReturnType<typeof engine.submitCase>>;
        for (let t = 1; t <= CASE_TRIES; t++) {
          try {
            result = await engine.submitCase(caseData, filesToUpload, {
              dryRun: isDryRun,
              // Bosqichni bazaga yozamiz — UI navbat panelida «Ketyapti · Hujjatlar (15 ta)»
              // deb ko'rsatadi. Yozuv muhim emas: yiqilsa ish to'xtamasin.
              onStep: (step) => {
                const label = t > 1 ? `${step} (${t}-urinish)` : step;
                void prisma.courtQueueItem.update({ where: { caseId: ac.id }, data: { step: label } }).catch(() => {});
              },
            });
            break;
          } catch (e: any) {
            const kind = e?.kind as string | undefined;
            const transient = kind === 'SERVER' || kind === 'BLOCKED' || kind === 'RATE_LIMIT';
            if (!transient || t === CASE_TRIES) throw e;
            console.warn(`⚠ [Job ${jobId}] ${caseIndexStr} portal nosozligi (${kind}) — ${t}/${CASE_TRIES}, qayta urinamiz...`);
            await new Promise((r) => setTimeout(r, 8_000 * t));
          }
        }

        if (result.ok && !isDryRun) {
          await prisma.arizaCase.update({
            where: { id: ac.id },
            data: {
              stage: 'COURT_SUBMITTED',
              stageEnteredAt: new Date(),
              courtSentAt: new Date(),
              courtCaseId: result.caseId || result.caseNumber || result.registryNumber || null,
              meta: {
                ...((ac.meta as any) || {}),
                exportedAt: new Date().toISOString(),
                cabinetDraftId: result.draftId,
                cabinetSubmittedAt: new Date().toISOString(),
                caseNumber: result.caseNumber,
                registryNumber: result.registryNumber,
              },
            },
          });
          console.log(`✔ [Job ${jobId}] Case #${ac.id} topshirildi! Ish raqami: ${result.caseNumber || result.draftId}`);
        } else if (result.ok && isDryRun) {
          console.log(`✔ [Job ${jobId}] Case #${ac.id} DRY-RUN muvaffaqiyatli!`);
        }

        if (result.ok) {
          okCount++;
          consecutiveBlocked = 0; // muvaffaqiyat — portal sog'lom, hisoblagich nolga
          void resetQueueBackoff().catch(() => {}); // kutish jadvali ham boshiga
          await syncCourtCabinetState(ac.courtId, true);
          await prisma.courtQueueItem.update({
            where: { caseId: ac.id },
            data: {
              state: 'DONE', finishedAt: new Date(), lastError: null,
              draftId: result.draftId ?? null, caseNumber: result.caseNumber ?? null,
            },
          });
          // DOIMIY TARIX: navbat yozuvi qayta urinishda ustiga yoziladi, bu esa qoladi.
          await audit(AuditAction.COURT_SUBMIT, {
            actor: QUEUE_ACTOR,
            target: `case:${ac.id}`,
            detail: {
              natija: isDryRun ? 'DRY-RUN' : 'yuborildi', firma: firm.shortName, mijoz: ac.clientName,
              pinfl: ac.pinfl, sud: ac.court?.shortName ?? null, summa: String(ac.totalDebt),
              ishRaqami: result.caseNumber ?? null, draftId: result.draftId ?? null, jobId,
            },
          });
        } else {
          failCount++;
          await syncCourtCabinetState(ac.courtId, false, result.error);
          console.error(`❌ [Job ${jobId}] Case #${ac.id} xatolik: ${result.error}`);
          await prisma.courtQueueItem.update({
            where: { caseId: ac.id },
            data: {
              state: 'FAILED', finishedAt: new Date(),
              lastError: result.error ?? 'Nomaʼlum xato', draftId: result.draftId ?? null,
            },
          });
          await audit(AuditAction.COURT_SUBMIT, {
            actor: QUEUE_ACTOR,
            target: `case:${ac.id}`,
            detail: {
              natija: 'YUBORILMADI', firma: firm.shortName, mijoz: ac.clientName, pinfl: ac.pinfl,
              xato: result.error ?? 'Nomaʼlum xato', draftId: result.draftId ?? null, jobId,
            },
          });
        }
      } catch (err: any) {
        failCount++;
        await syncCourtCabinetState(ac.courtId, false, String(err?.message || err));
        console.error(`❌ [Job ${jobId}] Case #${ac.id} istisno:`, err.message);
        await prisma.courtQueueItem.update({
          where: { caseId: ac.id },
          data: { state: 'FAILED', finishedAt: new Date(), lastError: String(err?.message || err).slice(0, 2000) },
        });
        await audit(AuditAction.COURT_SUBMIT, {
          actor: QUEUE_ACTOR,
          target: `case:${ac.id}`,
          detail: {
            natija: 'YUBORILMADI', firma: firm.shortName, mijoz: ac.clientName, pinfl: ac.pinfl,
            xato: String(err?.message || err).slice(0, 500),
            turi: err instanceof CabinetRequestError ? err.kind : 'ISTISNO', jobId,
          },
        });

        // CIRCUIT BREAKER.
        //
        // SESSIYA (AUTH) — darhol to'xtaymiz: token o'lgan, keyingi har bir ish ham
        // yiqiladi, urinishning ma'nosi yo'q.
        //
        // TARMOQ/PORTAL (BLOCKED, RATE_LIMIT) — bitta xato hali blok degani emas. Portal
        // vaqti-vaqti bilan 502 yoki timeout beradi (2026-09-07 da aynan shunday bo'ldi).
        // Avval SHU YERDA butun partiya to'xtardi: bitta tasodifiy timeout 90 ta qolgan
        // ishni to'xtatib qo'yardi. Endi KETMA-KET 3 marta bo'lsagina to'xtaymiz — bu
        // haqiqiy blokning belgisi. Bitta-ikkitasi bo'lsa o'sha ish FAILED bo'ladi
        // (keyin qayta uriniladi) va navbat davom etaveradi.
        if (err instanceof CabinetRequestError && err.kind === 'AUTH') {
          stopReason = 'Cabinet sessiyasi tugagan — E-IMZO bilan qayta imzolang, so\'ng davom eting';
          console.error(`⛔ [Job ${jobId}] Navbat to'xtatildi: ${stopReason}`);
          break;
        }
        if (err instanceof CabinetRequestError && err.stopsQueue) {
          consecutiveBlocked++;
          console.warn(`⚠ [Job ${jobId}] Portal nosozligi (${err.kind}) — ketma-ket ${consecutiveBlocked}/${MAX_CONSECUTIVE_BLOCKED}`);
          if (consecutiveBlocked >= MAX_CONSECUTIVE_BLOCKED) {
            backoff(15 * 60_000);
            // Keyingi urinish vaqtini belgilaymiz — worker o'zi qayta boshlaydi
            // (5→5→5→30→60→120 daqiqa). Operator hech narsa bosmaydi.
            const b = await noteQueueBlocked();
            stopReason = `Portal ketma-ket ${consecutiveBlocked} marta javob bermadi — ${b.waitMin} daqiqadan keyin avtomat qayta urinadi`;
            console.error(`⛔ [Job ${jobId}] ${stopReason}`);
            break;
          }
          // Qisqa nafas olib davom etamiz — portal o'ziga kelishi mumkin.
          await new Promise((r) => setTimeout(r, 10_000));
        }
      }

      // Progress + oraliq hisobot. Progress har ishdan keyin yoziladi — bu ayni paytda
      // worker'ning "tirikman" belgisi ham (orphan sweep Job.updatedAt'ga qaraydi va
      // 15 daqiqa qimirlamagan RUNNING job'ni o'lik deb belgilaydi; biz har ~60s yozamiz).
      await prisma.job.update({
        where: { id: jobId },
        data: { progress: idx + 1, message: `${okCount} ta yuborildi, ${failCount} ta xato` },
      });
    }

    // Qolgan (umuman urinilmagan) ishlar PENDING bo'lib qoladi — operator qaytadan bosса
    // aynan shulardan davom etadi.
    const leftover = await prisma.courtQueueItem.count({ where: { jobId, state: { in: ['PENDING', 'RUNNING'] } } });

    // KUNLIK LIMITNI QAYTARISH. `consumeCourtSend` limitni partiya BOSHLANISHIDA yozadi
    // (courtSentAt) — bu poyga xavfini oldini oladi, lekin haqiqatan yuborilmagan ishlar ham
    // limitni «yeb» qo'yadi. 2026-09-07 da aynan shunday bo'ldi: 99 ta ish uzilib qoldi,
    // lekin Sudlar sahifasida «101/200 ishlatilgan» deb turdi. Yuborilmaganlarini qaytaramiz.
    const notSent = await prisma.courtQueueItem.findMany({
      where: { jobId, state: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
      select: { caseId: true },
    });
    if (notSent.length) {
      await releaseCourtSend(notSent.map((x) => x.caseId));
      console.log(`[Job ${jobId}] ${notSent.length} ta yuborilmagan ishning kunlik limiti qaytarildi.`);
    }

    // HALOL YAKUN: avval xato bo'lsa ham "Barcha ishlar muvaffaqiyatli topshirildi" deb
    // yozilardi — operator 100 ta ish ketdi deb o'ylab, aslida hech biri ketmagan bo'lishi
    // mumkin edi. Endi holat aniq raqamlar bilan ko'rinadi.
    const parts = [`${okCount} ta yuborildi`];
    if (failCount > 0) parts.push(`${failCount} ta XATO`);
    if (doneIds.size > 0) parts.push(`${doneIds.size} ta avval yuborilgan (o'tkazildi)`);
    if (leftover > 0) parts.push(`${leftover} ta navbatda qoldi`);
    if (stopReason) parts.push(`— ${stopReason}`);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        // Bironta ish ketmagan bo'lsa bu muvaffaqiyat emas — FAILED deb ko'rsatiladi.
        status: okCount === 0 && failCount > 0 ? 'FAILED' : 'DONE',
        message: parts.join(', '),
      },
    });
    // Partiya yakuni — /jurnal'da bitta qatorda ko'rinadi (kim, qachon, qancha, natija).
    await audit(AuditAction.COURT_SUBMIT, {
      actor: QUEUE_ACTOR,
      target: `firm:${firm.id}`,
      detail: {
        natija: 'partiya yakunlandi', firma: firm.shortName, jobId,
        yuborildi: okCount, xato: failCount, avvalYuborilgan: doneIds.size,
        navbatdaQoldi: leftover, toxtashSababi: stopReason, dryRun: isDryRun,
      },
    });
    console.log(`🎉 [Job ${jobId}] Yakun: ${parts.join(', ')}`);
  } catch (fatal: any) {
    console.error(`❌ [Job ${jobId}] Bosh xatolik:`, fatal.message);
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        message: fatal.message,
      },
    });
  }
}
