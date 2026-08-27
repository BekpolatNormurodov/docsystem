// Konveyer → MIB monitoring ko'prigi. Voronkaning MIB bosqichidagi ishlaridan (MIB_SUBMITTED +
// CLOSED — "sudda yutib ijroga chiqqanlar") bitta MibReport urug'lantiradi, so'ng AYNAN standalone
// «MIB hisoboti»dagi engine + ko'rinish shu report ustidan ishlaydi. Ya'ni HISOBOT Excel o'rniga
// kirish PINFL ro'yxati bevosita konveyerdan keladi — qolgani (mib.uz pull, natija ko'rsatish) o'sha.
//
// Report `sourceFileName = "konveyer:s<snapshotId>"` markeri bilan belgilanadi: shu orqali standalone
// MIB hisoboti ro'yxatidan chiqarib tashlanadi (ular alohida turadi) va qayta urug'lantirishda topiladi.
import { prisma } from '@/lib/db';
import type { CaseStage } from '@prisma/client';

// "MIBga chiqqan" = ijro bosqichi (EXEC): MIB'ga topshirilgan + yopilgan. mibEligibleCases bilan bir xil.
const MIB_STAGES: CaseStage[] = ['MIB_SUBMITTED', 'CLOSED'];

export const KONVEYER_MARKER_PREFIX = 'konveyer:';
const marker = (snapshotId?: number) => `${KONVEYER_MARKER_PREFIX}s${snapshotId ?? 'all'}`;

/** Snapshot berilmasa — oxirgi READY snapshot (mibEligibleCases / konveyerPersons bilan bir xil). */
async function resolveSnapshotId(snapshotId?: number): Promise<number | undefined> {
  if (snapshotId) return snapshotId;
  const latest = await prisma.snapshot.findFirst({
    where: { status: 'READY' },
    orderBy: { reportDate: 'desc' },
    select: { id: true },
  });
  return latest?.id ?? undefined;
}

export interface KonveyerMibScope {
  snapshotId?: number;
  reportId: number | null; // mavjud konveyer-report (bo'lmasa null)
  mibCases: number; // konveyerda MIBga chiqqan alohida PINFL soni
  seeded: number; // reportga allaqachon urug'langan mijozlar soni
}

/** Faqat O'QISH: scope bo'yicha nechta MIB case bor + mavjud konveyer-report id. Hech nima yozmaydi. */
export async function konveyerMibScope(opts: { snapshotId?: number }): Promise<KonveyerMibScope> {
  const snapshotId = await resolveSnapshotId(opts.snapshotId);
  const where = { stage: { in: MIB_STAGES }, ...(snapshotId ? { snapshotId } : {}) };
  const distinct = await prisma.arizaCase.findMany({ where, select: { pinfl: true }, distinct: ['pinfl'] });
  const mibCases = distinct.filter((r) => r.pinfl).length;
  const report = await prisma.mibReport.findFirst({
    where: { sourceFileName: marker(snapshotId) },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  const seeded = report ? await prisma.mibClient.count({ where: { reportId: report.id } }) : 0;
  return { snapshotId, reportId: report?.id ?? null, mibCases, seeded };
}

/**
 * Konveyer MIB-reportini yaratadi/yangilaydi. Idempotent: FAQAT yangi PINFL'larni PENDING qilib
 * qo'shadi, allaqachon tekshirilgan (DONE/CLEAN) mijozlar va ularning natijalarini saqlaydi —
 * shuning uchun qayta bosish tortilgan ma'lumotni o'chirib yubormaydi.
 */
export async function seedKonveyerMibReport(
  opts: { snapshotId?: number; createdBy?: string | null },
): Promise<{ reportId: number; total: number; added: number }> {
  const snapshotId = await resolveSnapshotId(opts.snapshotId);
  const where = { stage: { in: MIB_STAGES }, ...(snapshotId ? { snapshotId } : {}) };

  // Har PINFL bo'yicha bitta vakil qator (ism/firma/sud ish raqami) — eng katta qarzlisi birinchi.
  const rows = await prisma.arizaCase.findMany({
    where,
    orderBy: [{ totalDebt: 'desc' }, { id: 'asc' }],
    select: { pinfl: true, clientName: true, courtCaseId: true, firm: { select: { shortName: true } } },
  });
  const byPinfl = new Map<string, { pinfl: string; fio: string | null; firm: string | null; ish: string | null }>();
  for (const r of rows) {
    if (!r.pinfl || byPinfl.has(r.pinfl)) continue;
    byPinfl.set(r.pinfl, { pinfl: r.pinfl, fio: r.clientName, firm: r.firm?.shortName ?? null, ish: r.courtCaseId });
  }

  // Report'ni topamiz yoki yaratamiz (marker bo'yicha barqaror).
  let report = await prisma.mibReport.findFirst({
    where: { sourceFileName: marker(snapshotId) },
    orderBy: { id: 'desc' },
  });
  if (!report) {
    report = await prisma.mibReport.create({
      data: {
        createdBy: opts.createdBy ?? null,
        label: 'Konveyer — MIB monitoring',
        sourceFileName: marker(snapshotId), // standalone ro'yxatdan shu prefiks bilan chiqariladi
        sourcePath: '', // fayl yo'q — build/parse ishlatilmaydi (mijozlar bevosita urug'lanadi)
        statusFilter: 'Konveyer',
      },
    });
  }

  // Faqat yangi PINFL'lar (mavjudlarini — natijalari bilan — tegmaymiz).
  const existing = await prisma.mibClient.findMany({ where: { reportId: report.id }, select: { pinfl: true } });
  const have = new Set(existing.map((e) => e.pinfl));
  const toAdd = [...byPinfl.values()].filter((c) => !have.has(c.pinfl));
  if (toAdd.length) {
    await prisma.mibClient.createMany({
      data: toAdd.map((c) => ({
        reportId: report!.id,
        pinfl: c.pinfl,
        fio: c.fio,
        firm: c.firm,
        ishRaqami: c.ish,
        holat: 'Konveyer',
      })),
    });
  }

  const total = await prisma.mibClient.count({ where: { reportId: report.id } });
  await prisma.mibReport.update({ where: { id: report.id }, data: { total } });
  return { reportId: report.id, total, added: toAdd.length };
}
