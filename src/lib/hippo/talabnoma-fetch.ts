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

/** Mijozning (pinfl) yetkazilgan talabnoma xatini har uid × har firma sessiyasi bilan qidiradi. */
export async function fetchDeliveredTalabnoma(pinfl: string, ownStir?: string | null): Promise<Buffer | null> {
  if (!pinfl) return null;
  const rows = await prisma.clientCaseStatus.findMany({
    where: { source: 'HIPPO', category: 'talabnoma', pinfl, caseNumber: { not: null }, NOT: { caseNumber: { startsWith: 'TLB:' } } },
    orderBy: { updatedAt: 'desc' }, select: { caseNumber: true },
  });
  const uids = [...new Set(rows.map((r) => r.caseNumber).filter((x): x is string => !!x))];
  if (!uids.length) return null;
  // Sessiya tartibi: avval case firmasi (eng ehtimoliy), keyin qolgan firmalar.
  const stirs = [...new Set([digits(ownStir), ...FIRMS.map((f) => digits(f.stir))].filter(Boolean))];
  const sessions: any[] = [];
  for (const st of stirs) { const s = await sessionFor(st); if (s) sessions.push(s); }
  if (!sessions.length) return null;
  for (const uid of uids) {
    for (const s of sessions) {
      try { const b: any = await downloadMailPdf(s, uid); if (b && b.length > 1000) return Buffer.from(b); } catch { /* keyingi sessiya/uid */ }
    }
  }
  return null;
}
