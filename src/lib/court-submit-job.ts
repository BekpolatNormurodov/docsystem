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
import { paidReceiptSet, unpaidQueueReason } from './court-ready';
import { noteQueueBlocked, resetQueueBackoff } from './court-auto-resume';
import { resolveCabinetCourtGuid, regionForCourt } from '../../cabinet-api-skeleton/constants';
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
      // NOTANISH tur «OFERTA» BO'LMASLIGI kerak. Ilgari standart qiymat OFERTA edi, ya'ni
      // istalgan qo'lda yuklangan/nomalum turdagi fayl «oferta» bo'lib hisoblanardi va
      // MAJBURIY «oferta bormi?» tekshiruvini ALDAB o'tardi — da'vo haqiqiy shartnomasiz,
      // lekin «to'liq» deb ketardi. Endi notanish tur BOSHQA_HUJJATLAR bo'ladi: u sudga
      // baribir biriktiriladi, lekin yozma asos o'rnini BOSMAYDI.
      const KIND_MAP: Record<string, CaseFileToUpload['kind']> = {
        SIGNED_ARIZA: 'ARIZA', ARIZA: 'ARIZA',
        TALABNOMA: 'TALABNOMA', TALABNOMA_RECEIPT: 'TALABNOMA_CHECK',
        GUVOHNOMA: 'GUVOHNOMA', ISHONCHNOMA: 'ISHONCHNOMA',
        SHARTNOMA: 'SHARTNOMA', OFERTA: 'OFERTA',
      };
      const kind: CaseFileToUpload['kind'] = KIND_MAP[String(doc.kind)] ?? 'BOSHQA';

      // TAKRORNI TO'SISH: CaseDocument.kind da unique cheklov yo'q, shuning uchun bitta
      // hujjat (masalan Talabnoma kvitansiyasi) ikki qatorda turishi mumkin — 2026-09-06
      // sinovida aynan shunday bo'ldi va sudga bir xil fayl 2 marta ketardi.
      if (filesToUpload.some((f) => f.fileName === doc.fileName && f.kind === kind)) continue;
      filesToUpload.push({ kind, fileName: doc.fileName, buffer: buf });
    } catch {}
  }

  // B) (OLIB TASHLANDI) Diskdagi `$HOME/Downloads/BRIGHT FUTURE FINANCING …` papkalari.
  //
  // Bu blok firmani UMUMAN tekshirmasdan, nomida BRIGHT yozilgan papkalardan fayl olib
  // istalgan firmaning da'vosiga biriktirardi — ya'ni URBAN'ning da'vosiga BRIGHT'ning
  // hujjati tushishi mumkin edi. Bundan tashqari fayl NOMI bo'yicha tur taxmin qilinardi
  // (`/ariza/i` va h.k.), ya'ni tasodifiy nomli fayl «ariza» bo'lib majburiy tekshiruvni
  // aldardi. Productionda bu yo'llar mavjud emas (dev mashinaning papkalari), shuning
  // uchun blok butunlay olib tashlandi — hujjatlar faqat BAZADAN olinadi.

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
    // `sortOrder` amalda hamma qatorda 0 (hech kim qo'lda qo'ymagan), ya'ni yolg'iz o'zi
    // hech narsani tartiblamaydi — `id` ikkinchi mezon bo'lmasa tartib tasodifiy qoladi.
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
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

  return sortCourtFiles(filesToUpload);
}

/**
 * HUJJATLARNI ARIZADA E'LON QILINGAN TARTIBGA SOLADI.
 *
 * NEGA: Yuqorichirchiq sudi ishlarni shu sabab bilan qaytardi —
 * «Ҳужжатлар тартибсиз ёки тескари сақланганлиги сабабли уларни ўқиш имконияти йўқ».
 *
 * Sabab kodda edi. Arizaning O'ZI (2-bet, «Ilova qilingan hujjatlar ro'yxati») sudga
 * ANIQ tartib va'da qiladi — `CHAMBER.attachments` (src/core/chamber.ts). Quyidagi jadval
 * shu ro'yxatning HAR BANDINI uni bajaradigan faylga bog'laydi — ikkisi bir joyda tursin,
 * aks holda ular yana bir-biridan uzoqlashadi:
 *
 *   ariza bandi                              → yuboriladigan fayl (kind)   → ADOLAT slot
 *   ─────────────────────────────────────────────────────────────────────────────────────
 *   (da'voning o'zi, ro'yxatda yo'q)         → ARIZA                       claimApplication
 *   1. SSP a'zolik shartnomasi va guvohnomasi→ SHARTNOMA, GUVOHNOMA        BOSHQA / GUVOHNOMA
 *   2. Ishonchnoma                           → ISHONCHNOMA                 ISHONCHNOMA
 *   3. Kredit shartnomasi                    → OFERTA (har kredit uchun)   BOSHQA_HUJJATLAR
 *   4. Ogohlantirish xatlari                 → TALABNOMA                   TALABNOMA
 *      (yetkazilgani dalili, ro'yxatda yo'q) → TALABNOMA_CHECK             TALABNOMA_CHECK
 *   5. Pochta xarajati to'lov topshiriqnomasi→ BOJI_RECEIPT                POCHTA_XARAJATI…
 *
 * Fayllar esa YIG'ILISH tartibida ketardi: avval `CaseDocument` qatorlari (ularning
 * o'zi `orderBy`siz — MySQL qaytargan tartibda, ya'ni bizning tizimga qachon
 * biriktirilganiga qarab), keyin firma hujjatlari, keyin oferta, talabnoma, kvitansiya.
 * Natijada bir ishda ariza birinchi, boshqasida pochta kvitansiyasi birinchi bo'lardi
 * (2026-09-07 tekshiruvi: 6355 — ariza avval, 6340/6339/6331 — kvitansiya avval), va
 * talabnoma ro'yxatda 4-o'rinda va'da qilingan bo'lsa ham hamma ofertalardan KEYIN
 * tushardi. Sudya arizadagi ro'yxat bo'yicha o'qishga urinsa, hujjatlar boshqa
 * tartibda — «tartibsiz».
 *
 * Shuning uchun tartib endi TASODIFIY EMAS, arizadagi ro'yxatdan kelib chiqadi.
 * Bir xil turdagi fayllar (bir nechta oferta) o'z ichida tartibini saqlaydi.
 */
const COURT_FILE_ORDER: Record<CaseFileToUpload['kind'], number> = {
  // Da'voning o'zi — har doim birinchi (portal uni `claimApplication` sifatida ajratadi).
  ARIZA: 0,
  // 1-ilova: «SSPga a'zolik shartnomasi va guvohnomasi» — shu tartibda.
  SHARTNOMA: 1,
  GUVOHNOMA: 2,
  // 2-ilova
  ISHONCHNOMA: 3,
  // 3-ilova: kredit shartnomasi = oferta (bir nechta bo'lishi mumkin)
  OFERTA: 4,
  // 4-ilova: ogohlantirish xati = talabnoma, va DARHOL ketidan uning yetkazilganlik
  // kvitansiyasi — ular juft o'qiladi (xatning mazmuni + yetkazilgani dalili).
  TALABNOMA: 5,
  TALABNOMA_CHECK: 6,
  // 5-ilova: pochta xarajati to'lov topshiriqnomasi (billing.sud.uz kvitansiyasi PDF)
  BOJI_RECEIPT: 7,
  // Ro'yxatda yo'q, turi aniqlanmagan hujjat — oxirida.
  BOSHQA: 8,
};

function sortCourtFiles(files: CaseFileToUpload[]): CaseFileToUpload[] {
  // `map`+`sort` bilan BARQAROR: bir xil turdagi fayllar (masalan 3 ta oferta) yig'ilish
  // tartibida qoladi, ya'ni kredit yozuvlari tartibi buzilmaydi.
  return files
    .map((f, i) => ({ f, i }))
    .sort((a, b) => (COURT_FILE_ORDER[a.f.kind] ?? 9) - (COURT_FILE_ORDER[b.f.kind] ?? 9) || a.i - b.i)
    .map((x) => x.f);
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
      // `code` — firma filial kodi; ClientCaseStatus.branchCode bilan bir xil, portalda
      // allaqachon da'vosi bor mijozlarni topish uchun kerak.
      select: { id: true, shortName: true, stir: true, code: true, cabinetClaimantId: true },
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
    // DIQQAT: SHU partiyaning ishlariga TEGILMAYDI. Ular hozirgina `consumeCourtSend` bilan
    // band qilingan va hali yuborilmagan — «osilib qolgan» ta'rifiga to'g'ri keladi, lekin
    // ularni bo'shatish sudning kunlik limitini SOXTA bo'shatadi: partiya davom etaveradi
    // va limitdan ortiq ariza ketishi mumkin (2026-09-07 auditi).
    const released = await prisma.arizaCase.updateMany({
      where: {
        firmId: firm.id,
        id: { notIn: opts.caseIds },
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
    // ADOLAT'da ishi BOR (courtCaseId yozilgan) case'lar ham o'tkazib yuboriladi — ular
    // yakuniy qadamda uzilgan bo'lishi mumkin, lekin da'vo rasman berilgan bo'lishi
    // ehtimoli bor. Qayta yuborish = bir odamga ikkinchi da'vo.
    const withCase = await prisma.arizaCase.findMany({
      where: { id: { in: opts.caseIds }, courtCaseId: { not: null } },
      select: { id: true },
    });
    for (const c of withCase) doneIds.add(c.id);
    const pendingIds = opts.caseIds.filter((id) => !doneIds.has(id));
    if (doneIds.size > 0) {
      console.log(`[Job ${jobId}] ${doneIds.size} ta ish allaqachon yuborilgan — o'tkazib yuborildi.`);
    }

    let targetCases = await prisma.arizaCase.findMany({
      where: { id: { in: pendingIds } },
      // `documents` ATAYIN tartiblangan: `orderBy`siz MySQL qaytargan tartib keladi va
      // u ishdan-ishga o'zgaradi (bir ishda ariza avval, boshqasida kvitansiya).
      // Yakuniy tartibni `sortCourtFiles` beradi, bu esa uning kirishini barqaror qiladi.
      include: { firm: true, court: true, documents: { orderBy: { id: 'asc' } } },
      orderBy: { id: 'asc' },
    });

    // ── PORTALDA ALLAQACHON DA'VOSI BOR ─────────────────────────────────────────────────
    //
    // Yuristlar ADOLAT'da to'g'ridan-to'g'ri ham ish qo'yishadi. `selectReadyCaseIds` bunday
    // ishlarni tanlamaydi, lekin `resume` va avto-davom navbatdan TO'G'RIDAN oladi va u
    // filtrni chetlab o'tadi. Shuning uchun to'siq DVIGATELNING O'ZIDA ham turadi —
    // bir odamga ikkinchi da'vo ochilishi qaytarib bo'lmaydigan xato.
    //
    // FAQAT ANIQ moslik (matchedBy='PINFL'): ism bo'yicha taxmin haqiqiy qarzdorni
    // jimgina konveyerdan chiqarib yuborardi (operator qarori, 2026-09-08).
    const casePinfls = [...new Set(targetCases.map((c) => c.pinfl).filter(Boolean) as string[])];
    //
    // QAYTARILGAN ISH TO'SIQ EMAS: `DECLINED` — sud ishni ko'rmasdan qaytargan, uni
    // tuzatib QAYTA yuborish kerak (tizimda «Suddan qaytganlar» oqimi bor). 2026-09-08
    // da bu farq yo'q edi va to'siqning yagona ta'siri BRIGHT'ning qaytarilgan 15 ta
    // ishini bloklash bo'ldi — ya'ni aynan teskarisi.
    const externalRows = casePinfls.length && firm.code
      ? await prisma.clientCaseStatus.findMany({
          where: {
            source: 'CABINET', branchCode: firm.code, matchedBy: 'PINFL',
            pinfl: { in: casePinfls },
            status: { not: 'DECLINED' },
          },
          select: { pinfl: true, caseNumber: true },
        })
      : [];
    // Portal ishlaridan qaysilari BIZNIKI: id'si `ArizaCase.courtCaseId` bilan bir xil.
    // Bu farq TO'SIQ uchun emas (ikkala holatda ham ikkinchi da'vo ochilmasligi kerak),
    // balki OPERATORGA aytiladigan SABAB uchun kerak: «yurist qo'lda kiritgan» va
    // «bizning boshqa qatorimizdan ketgan» — bular ikki xil muammo, ikki xil yechim.
    const ourPortalIds = new Set<string>();
    if (externalRows.length) {
      const ids: string[] = [];
      for (const r of externalRows) if (r.caseNumber) ids.push(r.caseNumber);
      if (ids.length) {
        const mine = await prisma.arizaCase.findMany({ where: { courtCaseId: { in: ids } }, select: { courtCaseId: true } });
        for (const m of mine) if (m.courtCaseId) ourPortalIds.add(m.courtCaseId);
      }
    }
    // pinfl -> { portal ish id'si, bizniki bo'lganmi }
    const externalByPinfl = new Map<string, { caseNumber: string; ours: boolean }>();
    for (const r of externalRows) {
      if (!r.pinfl || !r.caseNumber) continue;
      // Firmaning O'ZI ishtirokchi bo'lgan yozuv (da'vogar) — javobgar emas.
      if (firmStir && r.pinfl === firmStir) continue;
      const ours = ourPortalIds.has(r.caseNumber);
      const prev = externalByPinfl.get(r.pinfl);
      // Yuristniki (ours=false) ustunroq: sabab matni aniqroq bo'lsin.
      if (!prev || (prev.ours && !ours)) externalByPinfl.set(r.pinfl, { caseNumber: r.caseNumber, ours });
    }

    if (externalByPinfl.size) {
      const hit = targetCases.filter((c) => c.pinfl && externalByPinfl.has(c.pinfl));
      const why = (c: { pinfl: string | null }) => {
        const x = externalByPinfl.get(c.pinfl!)!;
        return x.ours
          ? `Bu mijozga ADOLAT'da da'vo ALLAQACHON ochilgan (${x.caseNumber}) — tizimning oldingi partiyasidan. `
            + `Ikkinchi da'vo ochilmasligi uchun yuborilmadi.`
          : `ADOLAT'da bu mijozga shu firma nomidan da'vo ALLAQACHON bor (${x.caseNumber}) — yurist qo'lda kiritgan. `
            + `Ikkinchi da'vo ochilmasligi uchun yuborilmadi.`;
      };
      for (const ac of hit) {
        await prisma.courtQueueItem.upsert({
          where: { caseId: ac.id },
          create: { caseId: ac.id, firmId: firm.id, account: firmStir, state: 'SKIPPED', jobId, finishedAt: new Date(), lastError: why(ac) },
          update: { state: 'SKIPPED', jobId, step: null, finishedAt: new Date(), lastError: why(ac) },
        });
      }
      await prisma.arizaCase.updateMany({
        where: { id: { in: hit.map((c) => c.id) }, stage: { not: 'COURT_SUBMITTED' } },
        data: { courtSentAt: null },
      });
      targetCases = targetCases.filter((c) => !c.pinfl || !externalByPinfl.has(c.pinfl));
      if (hit.length) console.log(`[Job ${jobId}] ${hit.length} ta ish portalda allaqachon da'vo qilingani uchun o'tkazib yuborildi.`);
    }

    // ── DAVLAT BOJI PREFLIGHT ────────────────────────────────────────────────────────────
    //
    // To'lanmagan bojli ishni portalga OLIB CHIQMAYMIZ. Portal `find-by-receipt-number`
    // da 400 «invoiceStatus is not valid» beradi, lekin bu bosqichgacha ish qoralama
    // yaratib, 10 ta hujjat yuklab bo'lgan bo'lardi — ADOLAT'da yetim qoralama qolardi.
    //
    // 2026-09-07: BRIGHT partiyasidagi 193 ta ishning 78 tasi aynan shunday edi. Bizning
    // bazamiz ham (BillingCheckInvoice.invoiceStatus = CREATED) buni BILARDI, ya'ni
    // portalga chiqishning umuman keragi yo'q edi.
    //
    // Bunday ish FAILED emas, SKIPPED bo'ladi: bu nosozlik emas, ish shunchaki hali
    // yuborishga tayyor emas. Qayta urinish hech narsani o'zgartirmaydi — to'lov kerak.
    // To'langach `invoiceStatus` PAID bo'ladi va ish o'zi navbatga qaytadi.
    const paidNos = await paidReceiptSet(targetCases.map((c) => c.receiptNumber ?? ''));
    const unpaid = targetCases.filter((c) => !c.receiptNumber || !paidNos.has(c.receiptNumber));
    const sendCases = targetCases.filter((c) => c.receiptNumber && paidNos.has(c.receiptNumber));

    // Navbat yozuvlarini tayyorlash: har case PENDING holatida ko'rinadi (operator darhol
    // "navbatda" deb ko'radi, ish boshlanishini kutmasdan).
    for (const ac of sendCases) {
      await prisma.courtQueueItem.upsert({
        where: { caseId: ac.id },
        create: { caseId: ac.id, firmId: firm.id, account: firmStir, state: 'PENDING', jobId },
        update: { state: 'PENDING', jobId, lastError: null, finishedAt: null },
      });
    }
    if (unpaid.length) {
      const why = (c: { receiptNumber: string | null }) => unpaidQueueReason(c.receiptNumber);
      for (const ac of unpaid) {
        await prisma.courtQueueItem.upsert({
          where: { caseId: ac.id },
          create: { caseId: ac.id, firmId: firm.id, account: firmStir, state: 'SKIPPED', jobId, lastError: why(ac), finishedAt: new Date() },
          update: { state: 'SKIPPED', jobId, lastError: why(ac), finishedAt: new Date(), step: null },
        });
      }
      // Kunlik sud limitini QAYTARAMIZ: partiya tuzilishida bu ishlarga courtSentAt
      // yozilgan edi (count-at-write), lekin ular yuborilmaydi. Bo'shatmasak sud limiti
      // yuborilmagan ishlar bilan «to'lib» qoladi.
      await prisma.arizaCase.updateMany({
        where: { id: { in: unpaid.map((c) => c.id) }, stage: { not: 'COURT_SUBMITTED' } },
        data: { courtSentAt: null },
      });
      console.log(`[Job ${jobId}] ${unpaid.length} ta ish boji to'lanmagani uchun o'tkazib yuborildi (portalga chiqilmadi).`);
    }
    targetCases = sendCases;
    // Partiya haqiqiy hajmi — o'tkazib yuborilganlarsiz. Busiz progress «0/195» bo'lib
    // qotib turardi, holbuki yuboriladigan ish 115 ta edi.
    await prisma.job.update({ where: { id: jobId }, data: { total: targetCases.length } }).catch(() => {});

    console.log(`[Job ${jobId}] Sudga topshirish boshlandi: ${targetCases.length} ta ish (${firm.shortName})`);
    console.log(`[Job ${jobId}] Tezlik: har so'rov orasida ${REQUEST_GAP_MS / 1000}s, ishlar orasida sud sozlamasi bo'yicha (default ${CASE_GAP_MS / 1000}s)`);

    let okCount = 0;
    let failCount = 0;
    // Boji to'lanmagani uchun o'tkazib yuborilganlar — «xato» emas, alohida sanaladi.
    let skipCount = unpaid.length + externalByPinfl.size;
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
      if (await isQueuePaused(opts.firmId)) {
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
        regionId: regionForCourt(courtGuid), // region sudning o'zidan olinadi
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
          // Xato TURI endi natijada keladi (submitter uni yutmaydi). AUTH — sessiya
          // o'lgan: qolgan ishlarni urinib ko'rish mantiqsiz, hammasi bir xil yiqiladi
          // va operator yuzlab soxta xato ko'radi. BLOCKED/RATE_LIMIT — portalni yanada
          // bosmaymiz.
          // SESSIYA (AUTH) — darhol to'xtaymiz: token o'lgan, keyingi har bir ish ham
          // yiqiladi.
          if (result.kind === 'AUTH') {
            stopReason = 'Cabinet sessiyasi tugagan — E-IMZO bilan qayta imzolang, so\'ng davom eting';
            console.error(`⛔ [Job ${jobId}] Navbat to'xtatildi: ${stopReason}`);
            break;
          }
          // BLOCKED/RATE_LIMIT — BITTA hodisa yetarli DALIL EMAS.
          //
          // 2026-09-07: portal bitta so'rovga 30 soniyada javob bermadi, kod uni «blok» deb
          // hisoblab 41 talik partiyani DARHOL o'ldirdi va butun navbatga 15 daqiqalik
          // sovutish qo'ydi. Portal esa sog'lom edi — keyingi tekshiruvda 0.13 soniyada
          // javob berdi. Ya'ni bitta sekin so'rov uchun operator 15 daqiqa qotib turgan
          // ekranga qarab o'tirdi.
          //
          // `consecutiveBlocked` hisoblagichi shu ish uchun yozilgan edi, lekin bu shox
          // undan OLDIN `break` qilgani uchun hech qachon ishlamasdi. Endi: har hodisada
          // qisqa sovutish va keyingi ishga o'tamiz; navbat faqat KETMA-KET
          // MAX_CONSECUTIVE_BLOCKED marta bo'lganda to'xtaydi — bu haqiqiy blok belgisi.
          // SERVER (5xx) HAM «portal ishlamayapti» degani.
          //
          // 2026-09-08: portal har so'rovga 502 qaytara boshladi («user/get — portal ichki
          // xatosi (502)»). `kindForStatus` 5xx ni SERVER deydi, hisoblagich esa faqat
          // BLOCKED/RATE_LIMIT ni sanardi — ya'ni to'xtatuvchi umuman ishlamadi va partiya
          // 200 ta ishning HAMMASINI birma-bir yiqitib chiqishga tushdi: har biriga urinish
          // sanog'i yozilib, hammasi FAILED bo'lardi va avtomat qayta urinish ham tugab
          // qolardi. Portal ketma-ket 5xx bersa, bu bitta ishning ma'lumoti emas — portalning
          // o'zi. Bitta-yarim 5xx esa baribir to'xtatmaydi: shart KETMA-KET uchta.
          if (result.kind === 'BLOCKED' || result.kind === 'RATE_LIMIT' || result.kind === 'SERVER') {
            consecutiveBlocked++;
            if (consecutiveBlocked >= MAX_CONSECUTIVE_BLOCKED) {
              backoff(15 * 60_000);
              const b = await noteQueueBlocked();
              stopReason = `Portal ketma-ket ${consecutiveBlocked} marta javob bermadi (${result.kind}) — ${b.waitMin} daqiqadan keyin avtomat qayta urinadi`;
              console.error(`⛔ [Job ${jobId}] Navbat to'xtatildi: ${stopReason}`);
              break;
            }
            // Qisqa nafas: 30s, 60s — portal o'ziga kelishi mumkin, partiya esa yashaydi.
            const cool = 30_000 * consecutiveBlocked;
            console.warn(`⚠ [Job ${jobId}] Portal javob bermadi (${result.kind}, ${consecutiveBlocked}/${MAX_CONSECUTIVE_BLOCKED}) — ${cool / 1000}s kutib davom etamiz.`);
            backoff(cool);
          }
          console.error(`❌ [Job ${jobId}] Case #${ac.id} xatolik: ${result.error}`);
          // Boji to'lanmagan — bu NOSOZLIK emas. Preflight buni bazadan tutadi, lekin
          // to'lov holati portalda boshqacha bo'lishi mumkin (yoki kvitansiya partiya
          // boshlangandan keyin bekor qilingan). Bunday ish SKIPPED bo'ladi: avtomat
          // qayta urinish uni cheksiz aylantirmaydi, operator esa sababini ko'radi.
          const skipUnpaid = result.reason === 'UNPAID_RECEIPT';
          if (skipUnpaid) {
            failCount--; // «xato» emas — pastdagi hisobga tushmasin
            skipCount++;
            await prisma.arizaCase.updateMany({
              where: { id: ac.id, stage: { not: 'COURT_SUBMITTED' } },
              data: { courtSentAt: null },
            });
          }
          await prisma.courtQueueItem.update({
            where: { caseId: ac.id },
            data: {
              state: skipUnpaid ? 'SKIPPED' : 'FAILED', finishedAt: new Date(),
              lastError: result.error ?? 'Nomaʼlum xato', draftId: result.draftId ?? null,
              caseNumber: result.caseId ?? null,
            },
          });
          // ⚠ ADOLAT'da ISH YARATILGAN, lekin yakuniy qadam uzilgan bo'lishi mumkin —
          // portal so'rovni allaqachon bajargan bo'lsa da'vo RASMAN berilgan. Bunday ishni
          // «yuborilmagan» deb qoldirib bo'lmaydi: keyingi partiyada qayta tanlanib,
          // AYNI ODAMGA IKKINCHI da'vo ochilardi. Shuning uchun id darhol yoziladi va
          // keyingi tanlovlarda bu ish chetlab o'tiladi (courtCaseId bo'yicha).
          if (result.caseId) {
            await prisma.arizaCase.update({
              where: { id: ac.id },
              data: { courtCaseId: result.caseId },
            });
            console.error(`⚠ [Job ${jobId}] Case #${ac.id}: ADOLAT'da ish YARATILGAN (${result.caseId}), lekin yakunlanmadi — qayta yuborilmaydi, qo'lda tekshiring.`);
          }
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
        data: {
          progress: idx + 1,
          message: `${okCount} ta yuborildi, ${failCount} ta xato${skipCount ? `, ${skipCount} ta boji to'lanmagan` : ''}`,
        },
      });
    }

    // ── «KETYAPTI» BO'LIB QOLGAN YOZUVLARNI YAKUNLASH ───────────────────────────────────
    //
    // Sikl `break` bilan chiqqanda ayni paytdagi ish RUNNING bo'lib qolib ketardi. 2026-09-07
    // da operator ekranda BIR VAQTDA UCHTA «Ketyapti…» ko'rdi, holbuki dvigatel bir daqiqada
    // bittadan yuboradi: ikkitasi o'lgan partiyalardan (#231, #232) qolgan arvoh edi — blok
    // shoxi ishni yakunlamasdan chiqib ketgan. Bu shunchaki chalkash ko'rinish emas: bunday
    // yozuv `resume` ga ham tushmaydi (u faqat PENDING oladi), ya'ni ish navbatdan
    // butunlay tushib qolardi.
    //
    // Tuzatishni har bir `break` yoniga emas, SHU YERGA qo'ydik: partiya qanday tugashidan
    // qat'i nazar (break, xato, normal yakun) o'zidan keyin RUNNING yozuv qoldirmaydi.
    //
    // Portalda IZI BOR ishlar (sud ish raqami yozilgan yoki case'da courtCaseId bor)
    // navbatga QAYTARILMAYDI — ular save-suit'dan o'tgan bo'lishi mumkin va qayta yuborish
    // ayni odamga ikkinchi da'vo ochadi.
    const leftRunning = await prisma.courtQueueItem.findMany({
      where: { jobId, state: 'RUNNING' },
      select: { id: true, caseId: true, caseNumber: true, case: { select: { courtCaseId: true } } },
    });
    if (leftRunning.length) {
      const risky = leftRunning.filter((x) => x.caseNumber || x.case?.courtCaseId);
      const safe = leftRunning.filter((x) => !x.caseNumber && !x.case?.courtCaseId);
      if (risky.length) {
        await prisma.courtQueueItem.updateMany({
          where: { id: { in: risky.map((x) => x.id) } },
          data: {
            state: 'FAILED', step: null, finishedAt: new Date(),
            lastError: 'Partiya uzilganda ADOLAT\'da ish allaqachon yaratilgan edi — qayta yuborilmaydi '
              + '(ikkinchi da\'vo xavfi). Portalda holatini qo\'lda tekshiring.',
          },
        });
      }
      if (safe.length) {
        await prisma.courtQueueItem.updateMany({
          where: { id: { in: safe.map((x) => x.id) } },
          data: { state: 'PENDING', step: null },
        });
      }
      console.log(`[Job ${jobId}] ${safe.length} ta yarim qolgan ish navbatga qaytarildi${risky.length ? `, ${risky.length} tasi portalda izi borligi uchun qo'lda tekshiriladi` : ''}`);
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
    // Boji to'lanmaganlar ALOHIDA ko'rsatiladi: bu xato emas va operator qiladigan ish
    // ham boshqa — kodni tuzatish emas, to'lovni o'tkazish.
    if (skipCount > 0) parts.push(`${skipCount} ta boji to'lanmagan (o'tkazildi)`);
    if (doneIds.size > 0) parts.push(`${doneIds.size} ta avval yuborilgan (o'tkazildi)`);
    if (leftover > 0) parts.push(`${leftover} ta navbatda qoldi`);
    if (stopReason) parts.push(`— ${stopReason}`);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        // Bironta ish ketmagan bo'lsa bu muvaffaqiyat emas — FAILED deb ko'rsatiladi.
        // O'tkazib yuborilganlar (boji to'lanmagan) buni FAILED qilmaydi: dvigatel to'g'ri
        // ishladi, yuboradigan ish bo'lmagan xolos.
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
        yuborildi: okCount, xato: failCount, bojiTolanmagan: skipCount, avvalYuborilgan: doneIds.size,
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
