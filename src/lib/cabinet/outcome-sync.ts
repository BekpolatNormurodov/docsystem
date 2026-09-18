// Sudga yuborilgan ishlarning HAQIQIY natijasini ADOLAT'dan olib, bazaga qaytaradi.
//
// NEGA KERAK: biz ishni yuborgach `stage = COURT_SUBMITTED` deb belgilaymiz va shu bilan
// tamom — sud uni RAD ETSA ham bazada «sudda» bo'lib qolaveradi. 2026-09-07 da aynan shunday
// bo'ldi: URBAN bo'yicha ketgan 41 ta ishning 34 tasi ADOLAT'da DECLINED bo'lgan
// («Жавобгар ЖШШИР маълумотлари тўлиқ киритилмаган»), lekin bazada hammasi «yuborilgan»
// bo'lib turardi. Operator buni ko'rmaydi va ishlar abadiy osilib qoladi.
//
// Bu modul portaldan statusni o'qib:
//   • DECLINED  -> stage COURT_RETURNED + eksport belgilari tozalanadi, ya'ni ish QAYTA
//     yuboriladigan bo'ladi (court-ready.ts: COURT_RETURNED ataylab SENT_STAGES da emas);
//   • qabul qilingan -> sud ish raqami saqlanadi.
import { prisma } from '../db';
import { getStoredCabinetSession } from './session';
import { cabinetFetch } from './api';

const asRows = (j: unknown): any[] =>
  Array.isArray(j) ? j : ((j as any)?.content ?? (j as any)?.data ?? []);

/** Portal ro'yxatidagi yozuvdan bizga kerakli id'larni yig'ish (nomlar turlicha bo'lishi mumkin). */
function idsOf(row: any): string[] {
  return ['id', 'case_id', 'claim_id']
    .map((k) => row?.[k])
    .filter(Boolean)
    .map(String);
}

export interface OutcomeSyncResult {
  firm: string;
  checked: number;   // bazada «yuborilgan» deb turgan ishlar
  matched: number;   // portalda topilgani
  declined: number;  // rad etilgani (qayta yuborishga qaytarildi)
  accepted: number;  // sud QABUL QILGAN (ro'yxatga olingan / ko'rilmoqda / qaror chiqqan)
  /** Portalda bor, lekin SUDGA BERILMAGAN qoralama (CREATED/DRAFT) — «qabul» EMAS. */
  notFiled: number;
  /** Bazada «yuborilgan», portal ro'yxatida esa YO'Q — id mos kelmayapti, tekshirish kerak. */
  missing: number;
  /** Bosqichi «yuborilgan», lekin portal id'si umuman yozilmagan — solishtirib bo'lmaydi. */
  noPortalId: number;
}

/**
 * Portal holati → bizning bosqich.
 *
 * NEGA KERAK: ilgari DECLINED'dan boshqa HAMMA holat bitta `else` shoxida «qabul» deb
 * sanalardi — shu jumladan CREATED, ya'ni SUDGA BERILMAGAN qoralama (2026-09-08 da
 * BRIGHT'da bunday 144 ta yozuv bor edi). Operatorga «qabul qilindi» deyilar, aslida
 * hech narsa berilmagan edi. Bundan tashqari ish REGISTER → IN_PROCESS → DECIDED →
 * FINISHED bo'lib borsa ham bazada bosqich O'ZGARMAS edi, ya'ni «sudga topshirilgan»dan
 * keyin hech narsa ko'rinmasdi — operator «qabul qilinsa bilmayapman» deganining sababi.
 */
const PORTAL_STAGE: Record<string, 'ACCEPTED' | 'NOT_FILED'> = {
  REGISTER: 'ACCEPTED',     // ro'yxatga olindi — da'vo qabul qilingan
  PENDING: 'ACCEPTED',      // ko'rib chiqish navbatida
  IN_PROCESS: 'ACCEPTED',   // ko'rilmoqda
  DECIDED: 'ACCEPTED',      // qaror chiqarilgan
  FINISHED: 'ACCEPTED',     // yakunlangan
  CREATED: 'NOT_FILED',     // qoralama — hali berilmagan
  DRAFT: 'NOT_FILED',
};

/**
 * Bitta firma bo'yicha natijalarni sinxronlaydi. Portalga ATIGI BITTA so'rov yuboradi
 * (butun ro'yxat), ya'ni tezlik chegarasiga sezilarli yuk bermaydi.
 */
export async function syncCourtOutcomes(firmId: number): Promise<OutcomeSyncResult> {
  const firm = await prisma.firm.findUnique({
    where: { id: firmId },
    select: { id: true, shortName: true, stir: true },
  });
  if (!firm) throw new Error(`Firma topilmadi: ${firmId}`);

  const cases = await prisma.arizaCase.findMany({
    where: { firmId, stage: 'COURT_SUBMITTED', courtCaseId: { not: null } },
    select: { id: true, courtCaseId: true, meta: true, stage: true },
  });
  // PORTAL ID'SIZ ISHLAR — solishtirib bo'lmaydi, lekin JIM qolmasligi kerak.
  //
  // `courtCaseId` yozilmagan bo'lsa (send-to-court javobida raqam kelmagan, yoki eski
  // yozuvda «YUBORILDI» kabi matn turgan) ish portal bilan solishtirilmaydi va abadiy
  // «sudga topshirilgan» bo'lib qoladi. Ilgari u sanoqqa ham tushmasdi.
  const noPortalId = await prisma.arizaCase.count({
    where: { firmId, stage: 'COURT_SUBMITTED', courtCaseId: null },
  });

  const res: OutcomeSyncResult = {
    firm: firm.shortName, checked: cases.length, matched: 0, declined: 0, accepted: 0,
    notFiled: 0, missing: 0, noPortalId,
  };
  if (!cases.length) return res;

  const account = (firm.stir || '').replace(/\D/g, '');
  const session = await getStoredCabinetSession(account);
  const r = await cabinetFetch(session, '/api/cabinet/case/civil/all-cases');
  if (r.status !== 200) throw new Error(`Portal ro'yxati olinmadi (status ${r.status})`);

  // portal id -> yozuv
  const byId = new Map<string, any>();
  for (const row of asRows(r.json)) for (const id of idsOf(row)) byId.set(id, row);

  for (const c of cases) {
    const hit = byId.get(String(c.courtCaseId));
    if (!hit) {
      // PORTALDA TOPILMADI — sanab, tashlab yubormaymiz.
      //
      // 2026-09-08: URBAN bo'yicha 100 ta ishning 100 tasi ham shu holatda edi (saqlangan
      // id portal ro'yxatidagi hech bir yozuvga to'g'ri kelmaydi). Ular COURT_SUBMITTED
      // bo'lib qolaveradi: qayta yuborilmaydi, hech qayerda ko'rinmaydi. Endi izi
      // `meta.portalMissingAt` da qoladi va operatorga ko'rsatiladi.
      //
      // BOSQICH O'ZGARTIRILMAYDI: id mos kelmagani «da'vo yo'q» degani EMAS — portalda
      // boshqa id bilan turgan bo'lishi mumkin. Uni «qaytgan» deb belgilash IKKINCHI
      // da'voga yo'l ochardi. Bu — odam tekshiradigan holat.
      res.missing++;
      const m = (c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta))
        ? { ...(c.meta as Record<string, unknown>) } : {};
      if (!m.portalMissingAt) {
        m.portalMissingAt = new Date().toISOString();
        await prisma.arizaCase.update({ where: { id: c.id }, data: { meta: m as any } }).catch(() => {});
      }
      continue;
    }
    res.matched++;
    const status = String(hit.current_status ?? hit.status ?? '').toUpperCase();
    const meta = (c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta))
      ? { ...(c.meta as Record<string, unknown>) } : {};

    // Sud nomi portal javobida bor — xabarga qo'shamiz, operator qaysi sud rad etganini
    // darhol ko'rsin (bir firma bir nechta sudga yuboradi).
    const courtName: string | null =
      hit?.names?.uz ?? hit?.names?.uz_cyr ?? hit?.court_name ?? null;

    if (status === 'DECLINED') {
      // Ish QAYTA yuborilishi kerak: bosqichni qaytaramiz va «chiqarilgan/yuborilgan»
      // belgilarini tozalaymiz — aks holda court-ready uni «Tayyor» deb ko'rsatmaydi
      // (sendable = ready && !exported && ...).
      delete meta.exportedAt;
      delete meta.cabinetSubmittedAt;
      meta.declinedAt = new Date().toISOString();
      meta.declinedCaseId = c.courtCaseId;
      await prisma.arizaCase.update({
        where: { id: c.id },
        data: {
          stage: 'COURT_RETURNED',
          stageEnteredAt: new Date(),
          courtSentAt: null,   // kunlik limit ham qaytariladi
          courtCaseId: null,   // rad etilgan ish id'si meta'da qoladi
          meta: meta as any,
        },
      });
      // Navbat yozuvi ham qayta urinishga tayyor bo'lsin.
      // SABABNI TAXMIN QILMAYMIZ.
      //
      // Ilgari bu yerda «Sabab odatda javobgar JShShIR ma'lumotlari» deb yozilardi. Bu bir
      // marta to'g'ri bo'lgan (2026-09-07, URBAN) va shundan keyin HAR QANDAY rad etishga
      // yopishtirilib kelaverdi. 2026-09-08 da Yuqorichirchiq butunlay boshqa sabab bilan
      // rad etdi («Ҳужжатлар тартибсиз ёки тескари сақланганлиги сабабли уларни ўқиш
      // имконияти йўқ») — operator esa navbatda eski, noto'g'ri sababni o'qirdi va
      // JShShIR'ni qidirib vaqt yo'qotardi. Portal API'si sabab matnini bermaydi (tekshirildi:
      // all-cases, get-one-case-by-id, histories — hech birida yo'q), shuning uchun uni
      // ADOLAT'ning o'z sahifasidan o'qish kerakligini AYTAMIZ.
      await prisma.courtQueueItem.updateMany({
        where: { caseId: c.id },
        data: {
          state: 'FAILED',
          lastError:
            `Sud rad etdi (DECLINED)${courtName ? ` — ${courtName}` : ''}. ` +
            `Sababi ADOLAT'da: ish sahifasidagi «Rad etish sabab(lar)i» bo'limida. ` +
            `Tuzatilgach ish qayta yuboriladi.`,
          finishedAt: new Date(),
        },
      });
      res.declined++;
    } else {
      const caseNumber = hit.case_number ?? hit.registry_number ?? null;
      const kind = PORTAL_STAGE[status];

      // Portal holati HAR DOIM saqlanadi — «sudda» dan keyin nima bo'layotgani ko'rinsin.
      let changed = false;
      if (caseNumber && meta.caseNumber !== caseNumber) { meta.caseNumber = caseNumber; changed = true; }
      if (meta.portalStatus !== status) { meta.portalStatus = status; changed = true; }
      if (meta.portalMissingAt) { delete meta.portalMissingAt; changed = true; } // topildi — eski belgi ketsin

      if (kind === 'NOT_FILED') {
        // QORALAMA — «qabul» EMAS. Bosqichga tegilmaydi: ish bizda «yuborilgan» deb
        // yozilgan, portalda esa berilmagan qoralama turibdi. Buni odam tekshirishi kerak,
        // avtomatik «qaytgan» deb belgilash IKKINCHI da'voga yo'l ochardi.
        res.notFiled++;
        if (!meta.portalNotFiledAt) { meta.portalNotFiledAt = new Date().toISOString(); changed = true; }
      } else {
        res.accepted++;
        if (meta.portalNotFiledAt) { delete meta.portalNotFiledAt; changed = true; }
        // SUD QABUL QILDI → bosqich oldinga suriladi. Ilgari bosqich COURT_SUBMITTED da
        // qotib qolardi va ish sudda ro'yxatga olinganini ham, qaror chiqqanini ham hech
        // kim ko'rmasdi. COURT_ACCEPTED ham SENT_STAGES ichida — ish qayta yuborilmaydi.
        if (kind === 'ACCEPTED' && c.stage !== 'COURT_ACCEPTED') {
          await prisma.arizaCase.update({
            where: { id: c.id },
            data: { stage: 'COURT_ACCEPTED', stageEnteredAt: new Date(), meta: meta as any },
          }).catch(() => {});
          changed = false; // meta shu yerda yozildi
        }
      }
      if (changed) {
        await prisma.arizaCase.update({ where: { id: c.id }, data: { meta: meta as any } }).catch(() => {});
      }
    }
  }

  return res;
}

// ── YURIST QO'LDA YUBORGAN QORALAMA RAD ETILSA → «QAYTA YUBORISH» ─────────────────────────
//
// NEGA KERAK: `syncCourtOutcomes` faqat BIZ yuborgan ishlarni (COURT_SUBMITTED + courtCaseId)
// ko'radi. Lekin real yuborish umumiy pauzada — ishlarni biz qoralama (suit) qilib tayyorlaymiz,
// sudga esa YURIST portaldan QO'LDA yuboradi. Sud uni rad etsa, bizda ish «Qoralama tayyor»
// (qilindi) bo'lib qolib ketardi: Go uni qayta olmaydi, operator ham ko'rmaydi. 2026-09-18 da
// shu tufayli 294 ta rad etilgan ish (BRIGHT 211, COMMUNITY 73, URBAN 10) qo'lda SQL bilan
// «Qayta yuborish»ga o'tkazildi — bu funksiya o'sha mantiqni avtomatlashtiradi.
//
// FAQAT BAZA (portalga so'rov yo'q — IP limitini yemaydi): `ClientCaseStatus` ni status/detal
// sikllari allaqachon to'ldirgan. Qoidalar:
//   • joriy snapshot, firma kodi; ish «qilingan» ko'rinishda (courtCaseId / qoralama belgisi);
//   • courtCaseId bo'lsa — AYNAN o'sha portal ishi rad etilgan; bo'lmasa — ish BIZ tayyorlagan va
//     mijozda rad/qaytgan yozuv bor;
//   • portalda OCHIQ ishi YO'Q (aks holda bir odamga ikkinchi da'vo) va tayyorlangandan keyin
//     sudda HAL BO'LGAN ishi yo'q;
//   • navbatda PENDING/RUNNING emas.
// Natija: stage COURT_RETURNED, qoralama/eksport belgilari tozalanadi (eski ish raqami
// meta.declinedCaseId'da qoladi), eski DONE navbat yozuvi → FAILED (aks holda court-submit
// idempotentligi uni «avval yuborilgan» deb o'tkazib yuborardi). Keyin Go uni o'zi oladi.
// Qayta yuborishga ASOS: sud ishni qaytargan/rad etgan/ko'rmagan. WITHDRAWN (da'vogar — yurist —
// o'zi qaytarib olgan) ATAYIN yo'q: bu ongli qaror, uni avtomatika bekor qilmaydi.
const RESEND_RESULTS = new Set(['RETURNED', 'REFUSED', 'UNCONSIDERED']);
// «Hal bo'lmagan» yakunlar (FINISHED + shu natija = da'vo mazmunan ko'rilmagan).
const UNRESOLVED_RESULTS = new Set(['RETURNED', 'REFUSED', 'UNCONSIDERED', 'WITHDRAWN']);
const OPEN_STATUSES = new Set(['ALLOCATE', 'CREATED', 'REGISTER', 'PENDING', 'IN_PROCESS']);
const KNOWN_STATUSES = new Set([...OPEN_STATUSES, 'DECLINED', 'DECIDED', 'FINISHED']);
const SENT_STAGES = new Set(['COURT_SUBMITTED', 'COURT_ACCEPTED']);
// Yopilgan / keyingi bosqichga (MIB) o'tgan ish — hech qachon avtomat qaytarilmaydi.
const FINAL_STAGES = ['MIB_SUBMITTED', 'CLOSED'] as const;

export interface DeclinedResetResult { firm: string; reset: number; queueFailed: number }

function metaObj(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === 'object' && !Array.isArray(meta) ? { ...(meta as Record<string, unknown>) } : {};
}

export type StatusRow = { branchCode: string; status: string | null; caseResult: string | null; caseNumber: string | null; claimId: string | null; updatedAt: Date };
const isResendRow = (r: StatusRow) =>
  r.status === 'DECLINED' ? r.caseResult !== 'WITHDRAWN' : (!!r.caseResult && RESEND_RESULTS.has(r.caseResult));
// Ehtiyotkor: FINISHED natijasiz ham «hal bo'lgan» hisoblanadi (UI uni «Yakunlangan» deydi).
const isDecidedRow = (r: StatusRow) =>
  r.status === 'DECIDED' || (r.status === 'FINISHED' && !(r.caseResult && UNRESOLVED_RESULTS.has(r.caseResult)));

/** Ishning O'Z portal id'lari: biz yuborgan (courtCaseId) va/yoki biz tayyorlagan qoralama (meta.cabinetCaseId). */
export function ownCaseIds(c: { courtCaseId: string | null; meta: unknown }): string[] {
  const m = metaObj(c.meta);
  return [c.courtCaseId, typeof m.cabinetCaseId === 'string' ? m.cabinetCaseId : null].filter((x): x is string => !!x);
}
const rowIs = (r: StatusRow, ids: string[]) => (!!r.caseNumber && ids.includes(r.caseNumber)) || (!!r.claimId && ids.includes(r.claimId));

/**
 * Sof qaror (test qilinadi): shu ish «Qayta yuborish»ga o'tkazilsinmi.
 *   • ishning O'Z portal ishi (ownCaseIds) ma'lum bo'lishi shart — odam bo'yicha taxmin YO'Q;
 *   • o'z ishining ENG YANGI yozuvi rad/qaytgan bo'lishi shart (eski «CREATED» qatori qolib ketgan
 *     bo'lsa ham eng yangisi hal qiladi), o'z ishlaridan birortasi HAL BO'LGAN bo'lmasligi kerak;
 *   • `personRows` — odamning BARCHA firma kodlaridagi yozuvlari: boshqa (o'ziniki bo'lmagan)
 *     OCHIQ da'vo bo'lsa — tegilmaydi (ehtiyotkor: branchCode ilgari firmalar orasida ko'chib
 *     yurgan, shuning uchun kod bo'yicha ajratishga ishonmaymiz); shu firma kodidagi HAL BO'LGAN
 *     yoki NOMA'LUM holatdagi yozuv ham to'xtatadi.
 */
export function shouldResetDeclined(c: { courtCaseId: string | null; meta: unknown }, firmCode: string, personRows: StatusRow[], ownRows: StatusRow[]): boolean {
  const ids = ownCaseIds(c);
  if (!ids.length) return false;
  const own = ownRows.filter((r) => rowIs(r, ids));
  if (!own.length) return false;
  const latest = [...own].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0];
  if (!isResendRow(latest)) return false;
  if (own.some(isDecidedRow)) return false;
  const others = personRows.filter((r) => !rowIs(r, ids));
  if (others.some((r) => r.status && OPEN_STATUSES.has(r.status))) return false;
  if (others.some((r) => r.branchCode === firmCode && (isDecidedRow(r) || !r.status || !KNOWN_STATUSES.has(r.status)))) return false;
  return true;
}

export async function resetDeclinedForResend(firmId: number, opts: { dryRun?: boolean } = {}): Promise<DeclinedResetResult> {
  const firm = await prisma.firm.findUnique({ where: { id: firmId }, select: { id: true, code: true, shortName: true } });
  if (!firm) throw new Error(`Firma topilmadi: ${firmId}`);
  const res: DeclinedResetResult = { firm: firm.shortName, reset: 0, queueFailed: 0 };
  if (!firm.code) return res;
  const snap = await prisma.snapshot.findFirst({ orderBy: { reportDate: 'desc' }, select: { id: true } });
  if (!snap) return res;

  // «Qilingan» ko'rinishdagi ishlar. COURT_RETURNED ham kiradi — qayta tayyorlangan qoralama
  // ikkinchi marta rad etilsa ham aniqlansin (idempotentlik belgilar orqali: tozalangan ishda
  // suitReadyAt/courtCaseId yo'q → nomzod emas).
  const all = await prisma.arizaCase.findMany({
    where: { firmId, snapshotId: snap.id, pinfl: { not: null }, stage: { notIn: [...FINAL_STAGES] } },
    select: { id: true, pinfl: true, stage: true, courtCaseId: true, meta: true },
  });
  const cand = all.filter((c) => ownCaseIds(c).length > 0 && (() => {
    const m = metaObj(c.meta);
    return !!c.courtCaseId || SENT_STAGES.has(c.stage) || m.suitReadyAt != null || m.draftReadyAt != null;
  })());
  if (!cand.length) return res;

  const sel = { branchCode: true, status: true, caseResult: true, caseNumber: true, claimId: true, updatedAt: true, pinfl: true } as const;
  const ids = [...new Set(cand.flatMap(ownCaseIds))];
  const [personRowsAll, ownRowsAll] = await Promise.all([
    prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', pinfl: { in: cand.map((c) => c.pinfl!) } }, select: sel }),
    prisma.clientCaseStatus.findMany({ where: { source: 'CABINET', OR: [{ caseNumber: { in: ids } }, { claimId: { in: ids } }] }, select: sel }),
  ]);
  const byPinfl = new Map<string, StatusRow[]>();
  for (const r of personRowsAll) {
    if (!r.pinfl) continue;
    const list = byPinfl.get(r.pinfl) ?? [];
    list.push(r);
    byPinfl.set(r.pinfl, list);
  }
  const busy = new Set((await prisma.courtQueueItem.findMany({
    where: { caseId: { in: cand.map((c) => c.id) }, state: { in: ['PENDING', 'RUNNING'] } }, select: { caseId: true },
  })).map((q) => q.caseId));

  for (const c of cand) {
    if (busy.has(c.id)) continue;
    const own = ownCaseIds(c);
    const ownRows = ownRowsAll.filter((r) => rowIs(r, own));
    if (!shouldResetDeclined(c, firm.code, byPinfl.get(c.pinfl!) ?? [], ownRows)) continue;
    if (opts.dryRun) { res.reset++; continue; }
    const m = metaObj(c.meta);
    delete m.suitReadyAt; delete m.draftReadyAt; delete m.exportedAt; delete m.cabinetSubmittedAt;
    m.declinedAt = new Date().toISOString();
    m.declinedCaseId = c.courtCaseId ?? (typeof m.cabinetCaseId === 'string' ? m.cabinetCaseId : null);
    m.returnResetNote = 'portal DECLINED/RETURNED — avtomat qayta yuborishga (resetDeclinedForResend)';
    const [, q] = await prisma.$transaction([
      prisma.arizaCase.update({
        where: { id: c.id },
        data: { stage: 'COURT_RETURNED', stageEnteredAt: new Date(), courtSentAt: null, courtCaseId: null, meta: m as any },
      }),
      prisma.courtQueueItem.updateMany({
        where: { caseId: c.id, state: 'DONE' },
        data: {
          state: 'FAILED', finishedAt: new Date(),
          lastError: 'Sud rad etdi (DECLINED/RETURNED) — qayta yuborishga qo\'yildi. Sababi ADOLAT\'da: ish sahifasidagi «Rad etish sabab(lar)i».',
        },
      }),
    ]);
    res.reset++;
    res.queueFailed += q.count;
  }
  return res;
}
