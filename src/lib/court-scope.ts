// Sud (ADOLAT / cabinet.sud.uz) yozuvlarining SNAPSHOT kesimi. Hisobot, Konveyer, Mijozlar, MIB va Qaytganlar
// hammasi SHU bitta qoidadan foydalanadi — har biri o'zicha filtrlaganda bir sana uchun to'rt xil javob chiqardi.
//
// ClientCaseStatus.snapshotId'ga TAYANILMAYDI: 2026-09-29 gacha ingest uni har sinxronda eng oxirgi snapshot
// bilan qayta yozardi (hamma eski yozuv #6 ga ko'chgan); endi u faqat «birinchi ko'rilgan davr».
//
// SUD (CABINET): ADOLAT ishi snapshot S ga tegishli ⇔ S dagi (firma × PINFL) ishi sud navbatida DONE
// (da'vo ADOLAT'da ochilgan). SKIPPED («allaqachon ketgan»), FAILED, PENDING — bu snapshot yubormagan.
// Bir juftlik bir necha snapshotdan yuborilgan bo'lsa (qaytgan ish qayta yuborilgan), ish BITTA snapshotga
// yoziladi: ish vaqtidan (registryDt, bo'lmasa birinchi ko'rilgan createdAt) oldin yuborgan eng oxirgisiga;
// hamma yuborishdan oldingi ish — birinchisiga. Shunda snapshotlar yig'indisi bitta ishni ikki marta sanamaydi.
import type { Prisma } from '@prisma/client';
import { prisma } from './db';
import { canonCode } from './talabnoma-form/filter';

export interface CourtRowRef {
  branchCode: string | null;
  pinfl: string | null;
  registryDt: Date | null;
  createdAt: Date;
}

export interface SnapshotCourtScope {
  snapshotId: number;
  /** Shu snapshotdan sudga yuborilgan PINFL'lar — so'rovni oldindan toraytirish uchun (pinfl IN …). */
  pinfls: string[];
  /** Bu ADOLAT yozuvi shu snapshotga tegishlimi. */
  has(row: CourtRowRef): boolean;
}

/** (firma kodi × PINFL) kaliti — firma kodi oldidagi nollarsiz solishtiriladi (canonCode). */
export const courtPairKey = (branchCode: string | null | undefined, pinfl: string | null | undefined): string | null =>
  branchCode && pinfl ? `${canonCode(branchCode)}|${pinfl}` : null;

/** Snapshot berilmasa null — filtr yo'q (ADOLAT hozirgi holati, hamma ish). */
export async function snapshotCourtScope(
  snapshotId: number | null | undefined,
  caseWhere: Prisma.ArizaCaseWhereInput = {},
): Promise<SnapshotCourtScope | null> {
  if (!snapshotId) return null;
  const own = await prisma.courtQueueItem.findMany({
    where: { state: 'DONE', case: { snapshotId, pinfl: { not: null }, ...caseWhere } },
    select: { startedAt: true, createdAt: true, case: { select: { pinfl: true, kod: true } } },
  });
  const pinfls = [...new Set(own.map((q) => q.case.pinfl).filter((p): p is string => !!p))];
  // Shu juftliklarning BOSHQA snapshotlardan yuborilishi — ishni bitta snapshotga biriktirish uchun.
  const others = pinfls.length
    ? await prisma.courtQueueItem.findMany({
        where: { state: 'DONE', case: { pinfl: { in: pinfls }, snapshotId: { not: snapshotId } } },
        select: { startedAt: true, createdAt: true, case: { select: { pinfl: true, kod: true, snapshotId: true } } },
      })
    : [];
  // juftlik → yuborilishlar (vaqt bo'yicha). Legacy DONE yozuvlarda startedAt yo'q — navbatga qo'yilgan vaqt.
  const sends = new Map<string, { snap: number; at: number }[]>();
  for (const q of own) {
    const k = courtPairKey(q.case.kod, q.case.pinfl);
    if (!k) continue;
    const list = sends.get(k) ?? [];
    list.push({ snap: snapshotId, at: (q.startedAt ?? q.createdAt).getTime() });
    sends.set(k, list);
  }
  for (const q of others) {
    const list = sends.get(courtPairKey(q.case.kod, q.case.pinfl) ?? '');
    if (list && q.case.snapshotId != null) list.push({ snap: q.case.snapshotId, at: (q.startedAt ?? q.createdAt).getTime() });
  }
  for (const list of sends.values()) list.sort((a, b) => a.at - b.at);

  return {
    snapshotId,
    pinfls,
    has(row) {
      const list = sends.get(courtPairKey(row.branchCode, row.pinfl) ?? '');
      if (!list) return false;
      const t = (row.registryDt ?? row.createdAt).getTime();
      let owner = list[0]!;
      for (const s of list) if (s.at <= t) owner = s;
      return owner.snap === snapshotId;
    },
  };
}

/** Bitta da'vo — bitta qator. Ish raqami berilgach ingest yangi qator ochadi, eski case_id qatori ham
 *  holatga ergashadi — ikkalasining claimId'si bir xil (prod 2026-09-29: 564 ta da'vo ikki marta sanalardi). */
export function uniqueClaims<T extends { claimId: string | null }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    if (!r.claimId) return true;
    if (seen.has(r.claimId)) return false;
    seen.add(r.claimId);
    return true;
  });
}
