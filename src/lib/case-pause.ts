// ISH PAUZASI — ma'lumoti yetishmaydigan / tekshirilayotgan ishni SABAB (xabar) bilan to'xtatib qo'yish.
//
// NEGA (2026-09-30): 29.09 partiyasidagi arizalarni tekshirganda 29 ta «bo'sh shartnoma» (pul berilmagan
// kredit liniyasi — sanasiz, summasiz) va MUVAFFAQIYAT'ning 6 ta foiz stavkasiz ishi chiqdi. Ular
// ma'lumot to'ldirilguncha HECH QAYERGA ketmasligi kerak — ariza/paket ZIP'lari, ADOLAT qoralamasi va
// sudga yuborish, talabnoma. Operator ishni sabab bilan pauzaga qo'yadi, ro'yxatda «Pauza» + sabab
// ko'rinadi; ma'lumot kelgach pauzadan chiqaradi va ish odatdagi oqimga qaytadi.
//
// Saqlanishi: ArizaCase.meta.pause = { reason, at, by } — sxema o'zgarmaydi (prod `db push` xavfi yo'q).
// Yozuv ATOMAR (JSON_SET / JSON_REMOVE — resendHold bilan bir xil naqsh): meta'ning boshqa kalitlari
// (draftAt, suitReadyAt, courtSend …) parallel yozuvchilar bilan ustma-ust tushmaydi.
// `resendHold`dan farqi: u faqat SUD QAYTARGAN ish (paket tuzatilguncha, «Qaytganlar» tabida);
// pauza — istalgan ish, istalgan bosqichda, matnli sabab bilan.
import { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface CasePause { reason: string; at: string; by: string | null }

export const PAUSE_REASON_MAX = 300;

/** meta.pause → tuzilma; pauza yo'q (yoki obyekt emas) bo'lsa null. */
export function casePause(meta: unknown): CasePause | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const p = (meta as Record<string, unknown>).pause;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const o = p as Record<string, unknown>;
  return {
    reason: String(o.reason ?? '').trim(),
    at: typeof o.at === 'string' ? o.at : '',
    by: typeof o.by === 'string' && o.by ? o.by : null,
  };
}
export const isPaused = (meta: unknown): boolean => casePause(meta) !== null;

// SQL tomonda ham AYNAN shu ta'rif: meta.pause — OBYEKT (JSON null / satr pauza hisoblanmaydi).
const PAUSED_SQL = Prisma.sql`JSON_TYPE(JSON_EXTRACT(meta, '$.pause')) = 'OBJECT'`;

/** Pauzadagi ishlar id'lari (qamrov bo'yicha). `ids: []` → bo'sh to'plam (so'rovsiz). */
export async function pausedCaseIds(scope: { snapshotId?: number; firmId?: number; ids?: number[] } = {}): Promise<Set<number>> {
  if (scope.ids && !scope.ids.length) return new Set();
  const conds = [PAUSED_SQL];
  if (scope.snapshotId) conds.push(Prisma.sql`snapshotId = ${scope.snapshotId}`);
  if (scope.firmId) conds.push(Prisma.sql`firmId = ${scope.firmId}`);
  if (scope.ids) conds.push(Prisma.sql`id IN (${Prisma.join(scope.ids)})`);
  const rows = await prisma.$queryRaw<{ id: number }[]>`SELECT id FROM ArizaCase WHERE ${Prisma.join(conds, ' AND ')}`;
  return new Set(rows.map((r) => Number(r.id)));
}

/** Prisma `where` bo'lagi — qamrovdagi pauzadagi ishlarni chiqarib tashlaydi (pauza yo'q → `{}`). */
export async function notPausedWhere(scope: { snapshotId?: number; firmId?: number }): Promise<{ id?: { notIn: number[] } }> {
  const ids = await pausedCaseIds(scope);
  return ids.size ? { id: { notIn: [...ids] } } : {};
}

/** Ro'yxatdan pauzadagilarni ajratadi (tartib saqlanadi). */
export async function withoutPaused(caseIds: number[]): Promise<{ ids: number[]; paused: number[] }> {
  const p = await pausedCaseIds({ ids: [...new Set(caseIds)] });
  if (!p.size) return { ids: caseIds, paused: [] };
  return { ids: caseIds.filter((id) => !p.has(id)), paused: caseIds.filter((id) => p.has(id)) };
}

/** Pauzadagi `PINFL|firma kodi` juftliklari — kredit darajasida ishlaydigan oqimlar uchun
 *  (ariza eksporti, talabnoma): ArizaCase.kod === Loan.branchCode === Firm.code. */
export async function pausedPairs(snapshotId: number, firmId?: number): Promise<Set<string>> {
  const rows = await prisma.$queryRaw<{ pinfl: string | null; kod: string | null }[]>`
    SELECT pinfl, kod FROM ArizaCase
    WHERE snapshotId = ${snapshotId} ${firmId ? Prisma.sql`AND firmId = ${firmId}` : Prisma.empty} AND ${PAUSED_SQL}`;
  return new Set(rows.filter((r) => r.pinfl).map((r) => `${r.pinfl}|${r.kod ?? ''}`));
}

/**
 * Pauzaga qo'yish (`pause` berilsa) yoki pauzadan chiqarish (`null`). Qaytaradi — o'zgargan ishlar soni
 * va yozilgan pauza (UI qatorni qayta yuklamasdan yangilashi uchun).
 * Qayta pauzalash sababni YANGILAYDI (operator matnni tuzatishi mumkin).
 */
export async function setCasePause(
  caseIds: number[],
  pause: { reason: string; by: string | null } | null,
): Promise<{ changed: number; pause: CasePause | null }> {
  const ids = [...new Set(caseIds.filter((x) => Number.isInteger(x) && x > 0))];
  if (!ids.length) return { changed: 0, pause: null };
  if (pause) {
    const reason = pause.reason.trim().slice(0, PAUSE_REASON_MAX);
    if (!reason) throw new Error('Pauza sababi kerak');
    const at = new Date().toISOString();
    const changed = await prisma.$executeRaw`
      UPDATE ArizaCase
      SET meta = JSON_SET(COALESCE(meta, JSON_OBJECT()), '$.pause', JSON_OBJECT('reason', ${reason}, 'at', ${at}, 'by', ${pause.by})), updatedAt = NOW(3)
      WHERE id IN (${Prisma.join(ids)})`;
    return { changed, pause: { reason, at, by: pause.by } };
  }
  const changed = await prisma.$executeRaw`
    UPDATE ArizaCase SET meta = JSON_REMOVE(meta, '$.pause'), updatedAt = NOW(3)
    WHERE id IN (${Prisma.join(ids)}) AND JSON_EXTRACT(meta, '$.pause') IS NOT NULL`;
  return { changed, pause: null };
}
