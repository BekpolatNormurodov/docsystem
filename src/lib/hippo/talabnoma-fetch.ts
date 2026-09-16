// Yetkazilgan talabnoma xatini (hippo /mail/{uid}/download) topib beradi — court-submit va firma-zip
// ikkovi ham shuni ishlatadi. Ikki nozik holat hal qilinadi:
//   1) Bir mijoz (pinfl) bir necha marta yuborilgan bo'lishi mumkin (unique custom_id per send) →
//      HAMMA uid sinaladi, birinchi ochilgani olinadi.
//   2) Xat case FIRMASI akkauntidan EMAS, boshqa firma akkauntidan yuborilgan bo'lishi mumkin —
//      ko'p-firma direktor yoki ulashilgan operator akkaunt (masalan FUNDFLOW talabnomasi BRIGHT
//      akkauntidan ketgan; direktor sessiyasi 403 beradi). Shuning uchun case firmasi sessiyasi
//      ochmasa, QOLGAN firmalar sessiyalari ham sinaladi. Kesib olinadi (birinchi 200).
import { prisma } from '../db';
import { getStoredHippoSession } from './session';
import { downloadMailPdf } from './xat';
import { FIRMS } from '../firms';

const digits = (s: any) => String(s ?? '').replace(/\D/g, '');

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

// Mijozning barcha hippo talabnoma uid'lari + ochiladigan firma sessiyalari (case firmasi birinchi).
async function uidsAndSessions(pinfl: string, ownStir?: string | null): Promise<{ uids: string[]; sessions: any[] }> {
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', category: 'talabnoma', pinfl, caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } } },
    orderBy: { updatedAt: 'desc' }, select: { caseNumber: true },
  });
  const uids = [...new Set(rows.map((r) => r.caseNumber).filter((x): x is string => !!x))];
  const stirs = [...new Set([digits(ownStir), ...FIRMS.map((f) => digits(f.stir))].filter(Boolean))];
  const sessions: any[] = [];
  for (const st of stirs) { const s = await sessionFor(st); if (s) sessions.push(s); }
  return { uids, sessions };
}

/** Mijozning (pinfl) yetkazilgan talabnoma XATINI (/mail/download) har uid × har firma sessiyasi bilan qidiradi. */
export async function fetchDeliveredTalabnoma(pinfl: string, ownStir?: string | null): Promise<Buffer | null> {
  if (!pinfl) return null;
  const { uids, sessions } = await uidsAndSessions(pinfl, ownStir);
  if (!uids.length || !sessions.length) return null;
  for (const uid of uids) {
    for (const s of sessions) {
      try { const b: any = await downloadMailPdf(s, uid); if (b && b.length > 1000) return Buffer.from(b); } catch { /* keyingi sessiya/uid */ }
    }
  }
  return null;
}

/** Talabnoma «check» = hippo yetkazish kvitansiyasi (/perform/receipt/{uid}). Firma akkauntida stored
 *  UZPOST kvitansiyasi (TALABNOMA_RECEIPT) BO'LMAGANDA ishlatiladi (masalan FUNDFLOW). Owner'dan qat'i
 *  nazar ochiladi, lekin baribir har uid × har sessiya sinaladi (ba'zi holatda faqat egasiga beradi). */
export async function fetchTalabnomaCheck(pinfl: string, ownStir?: string | null): Promise<Buffer | null> {
  if (!pinfl) return null;
  const { uids, sessions } = await uidsAndSessions(pinfl, ownStir);
  if (!uids.length || !sessions.length) return null;
  const { downloadReceiptPdf } = await import('./xat');
  for (const uid of uids) {
    for (const s of sessions) {
      try { const b: any = await downloadReceiptPdf(s, uid); if (b && b.length > 1000) return Buffer.from(b); } catch { /* keyingi */ }
    }
  }
  return null;
}
