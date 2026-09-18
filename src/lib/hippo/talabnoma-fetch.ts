// Yetkazilgan talabnoma xatini (hippo /mail/{uid}/download) topib beradi — court-submit va firma-zip
// ikkovi ham shuni ishlatadi. Nozik holatlar:
//   1) Bir mijoz (pinfl) bir necha marta yuborilgan bo'lishi mumkin (unique custom_id per send) →
//      HAMMA uid sinaladi (eng yangi reyestr birinchi), birinchi ochilgani olinadi.
//   2) Xat per-creator: case firmasi sessiyasi 403 berishi mumkin — shuning uchun QOLGAN firmalar
//      sessiyalari ham sinaladi. Bu faqat «qaysi sessiya ochadi» masalasi; QAYSI XAT olinishini
//      esa pastdagi kreditor chegarasi belgilaydi.
//   3) KREDITOR CHEGARASI. Bir odam bir necha firmada qarzdor bo'lsa, har firma unga O'Z
//      talabnomasini yuborgan. Ilgari hamma firma xatlari aralash sinalardi (va o'z xati bo'lmasa
//      boshqalariga tushilardi) — BRIGHT'ning sud paketiga URBAN'ning talabnomasi tushib qolishi
//      mumkin edi. Endi FAQAT case firmasi kodidagi yozuvlar olinadi, boshqa firmaga o'tish yo'q.
//      ClientCaseStatus.branchCode = xatni sinxronlagan firma; har firma sessiyasi faqat O'Z hippo
//      tashkilotining reyestrlarini ko'radi (2026-09-18 tekshirildi: BRIGHT→org 3, URBAN→13,
//      COMMUNITY→12, FUNDFLOW→16), ya'ni kod = kreditor.
//   4) ENG YANGI REYESTR BIRINCHI (registryDt — haqiqiy yuborilgan sana; updatedAt har sync'da
//      yangilanadi, tartib bermaydi). Joriy kampaniya xati joriy qarz summasiga mos; bundan
//      tashqari BRIGHT org'ida FUNDFLOW'ning ilk (eski) xatlari bo'lishi mumkin — ular hech qachon
//      BRIGHT'ning joriy (#186, 05.09) xatidan oldin tanlanmaydi.
import { prisma } from '../db';
import { getStoredHippoSession } from './session';
import { downloadMailPdf } from './xat';
import { FIRMS } from '../firms';
import { PERFORM_TYPE } from './mail-status';

const digits = (s: any) => String(s ?? '').replace(/\D/g, '');

/** Xat haqiqatan pochtaga chiqqani ISBOTLANGAN ('SENT'/'Success' yoki pochta natijasi bor).
 *  Sana to'ldirish kabi «isbot» kerak joylar uchun. Jonli yuklashda ishlatilmaydi: holat faqat
 *  qo'lda sinxronlashda yangilanadi, 'InProgress'/'Null' eskirgan bo'lishi mumkin. */
export function isDispatched(status?: string | null): boolean {
  if (!status) return false;
  return status === 'SENT' || status === 'Success' || status in PERFORM_TYPE;
}
/** Pochta «yetkazildi» deb tasdiqlagan. */
export function isDelivered(status?: string | null): boolean {
  return !!status && PERFORM_TYPE[status]?.bucket === 'delivered';
}
/** Yuborilmagan qoralama — hech qachon sudga ketmaydi. */
const isDraft = (status?: string | null) => status === 'CREATED';

// Haqiqiy PDF (xato sahifasi/JSON emas). Ilgari faqat hajm (>1000 bayt) tekshirilardi.
export const isPdf = (b: Uint8Array | null | undefined) =>
  !!b && b.length > 1000 && Buffer.from(b.subarray(0, 4)).toString('latin1') === '%PDF';

// Firma sessiyalari — bulk (yuzlab case) davomida qayta-qayta yuklamaslik uchun qisqa TTL-memo.
// null = shu STIR sessiyasi ochilmadi (muddati o'tgan / yo'q) — qayta urinmaymiz.
const _sessCache = new Map<string, { s: unknown; t: number }>();
async function sessionFor(stir: string): Promise<any | null> {
  const key = digits(stir);
  if (!key) return null;
  const c = _sessCache.get(key);
  if (c && Date.now() - c.t < 120_000) return c.s as any;
  try { const s = await getStoredHippoSession(key); _sessCache.set(key, { s, t: Date.now() }); return s as any; }
  catch { _sessCache.set(key, { s: null, t: Date.now() }); return null; }
}

export interface FetchOpts {
  /** Oldindan SAQLASH (muzlatish) uchun: faqat ENG YANGI xat, va u pochtada «yetkazildi» bo'lsa.
   *  Hippo xatga «yetkazilgan» muhrini yetkazilgandan keyin bosadi — muhrsiz nusxani muzlatmaymiz. */
  deliveredOnly?: boolean;
}

/**
 * Case firmasiga TEGISHLI hippo talabnoma uid'lari (eng yangi reyestr birinchi) + ochiladigan firma
 * sessiyalari (case firmasi birinchi). `ownBranch` bo'lmasa — hech narsa: firma noma'lum bo'lsa
 * kreditorlarni taxmin qilmaymiz.
 */
async function uidsAndSessions(pinfl: string, ownStir: string | null | undefined, ownBranch: string | null | undefined, opts: FetchOpts = {}): Promise<{ uids: string[]; sessions: any[] }> {
  const none = { uids: [], sessions: [] };
  if (!ownBranch) return none;
  const rows = await prisma.clientCaseStatus.findMany({
    where: {
      source: 'HIPPO', category: 'talabnoma', pinfl, branchCode: ownBranch,
      caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } },
    },
    select: { caseNumber: true, status: true, registryDt: true },
  });
  let pick = rows.filter((r) => !isDraft(r.status));
  pick.sort((a, b) => (b.registryDt?.getTime() ?? 0) - (a.registryDt?.getTime() ?? 0));
  if (opts.deliveredOnly) pick = pick.length && isDelivered(pick[0].status) ? [pick[0]] : [];
  const uids = [...new Set(pick.map((r) => r.caseNumber).filter((x): x is string => !!x))];
  if (!uids.length) return none;
  const stirs = [...new Set([digits(ownStir), ...FIRMS.map((f) => digits(f.stir))].filter(Boolean))];
  const sessions: any[] = [];
  for (const st of stirs) { const s = await sessionFor(st); if (s) sessions.push(s); }
  return { uids, sessions };
}

/** Case firmasining yetkazilgan talabnoma XATI (/mail/download) — har uid × har firma sessiyasi. */
export async function fetchDeliveredTalabnoma(pinfl: string, ownStir?: string | null, ownBranch?: string | null, opts: FetchOpts = {}): Promise<Buffer | null> {
  if (!pinfl) return null;
  const { uids, sessions } = await uidsAndSessions(pinfl, ownStir, ownBranch, opts);
  for (const uid of uids) {
    for (const s of sessions) {
      try { const b: any = await downloadMailPdf(s, uid); if (isPdf(b)) return Buffer.from(b); } catch { /* keyingi sessiya/uid */ }
    }
  }
  return null;
}

/** Talabnoma «check» = hippo yetkazish kvitansiyasi (/perform/receipt/{uid}). Firma akkauntida stored
 *  UZPOST kvitansiyasi (TALABNOMA_RECEIPT) BO'LMAGANDA ishlatiladi. /perform org bo'ylab ochiladi —
 *  shuning uchun kreditor chegarasi (uid tanlovi) bu yerda ayniqsa muhim. */
export async function fetchTalabnomaCheck(pinfl: string, ownStir?: string | null, ownBranch?: string | null, opts: FetchOpts = {}): Promise<Buffer | null> {
  if (!pinfl) return null;
  const { uids, sessions } = await uidsAndSessions(pinfl, ownStir, ownBranch, opts);
  if (!uids.length) return null;
  const { downloadReceiptPdf } = await import('./xat');
  for (const uid of uids) {
    for (const s of sessions) {
      try { const b: any = await downloadReceiptPdf(s, uid); if (isPdf(b)) return Buffer.from(b); } catch { /* keyingi */ }
    }
  }
  return null;
}
