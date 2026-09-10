// Bitta PINFL qo'shib tekshirish mantig'i — HAM report ichidan (/api/mib/[id]/add-pinfl), HAM
// Excelsiz «Qo'lda tekshiruvlar» reportidan (/api/mib/check-pinfl) ishlatiladi. Natija ijro ishlari +
// tekshiruv sanasi bilan bazaga yig'ilib boradi (mavjud avtomator loopi orqali).
import { prisma } from '@/lib/db';
import { startMibRun, isMibRunActive, MANUAL_HOLAT } from './run';

// Excelsiz yakka tekshiruvlar shu barqaror reportga yig'iladi (marker bo'yicha topiladi/yaratiladi).
export const MANUAL_MARKER = 'manual:qolda';

export async function ensureManualReport(createdBy?: string | null): Promise<number> {
  const existing = await prisma.mibReport.findFirst({ where: { sourceFileName: MANUAL_MARKER }, orderBy: { id: 'desc' }, select: { id: true } });
  if (existing) return existing.id;
  const created = await prisma.mibReport.create({
    data: { createdBy: createdBy ?? null, label: 'Qoʻlda tekshiruvlar', sourceFileName: MANUAL_MARKER, sourcePath: '', statusFilter: MANUAL_HOLAT },
    select: { id: true },
  });
  return created.id;
}

export type AddPinflResult = { ok: true; clientId: number; running: boolean } | { ok: false; error: string };

export async function addPinflAndCheck(reportId: number, pinflRaw: string, fio?: string | null): Promise<AddPinflResult> {
  const pinfl = String(pinflRaw ?? '').replace(/\D/g, '');
  if (pinfl.length !== 14) return { ok: false, error: 'PINFL 14 ta raqamdan iborat boʻlishi kerak' };

  let client = await prisma.mibClient.findFirst({ where: { reportId, pinfl } });
  if (client) {
    // MUHIM: shu reportда jonli avtomator ISHLAYOTGAN bo'lsa — hech narsani o'chirmaymiz/reset qilmaymiz.
    // Aks holda ketayotgan run yaratgan ish o'chib, u mibCase.update'да «record not found»ga uchraydi.
    // Mavjud mijozni shunchaki qaytaramiz (kerak bo'lsa loop uni PENDING navbatidан oladi).
    if (isMibRunActive(reportId)) {
      return { ok: true, clientId: client.id, running: true };
    }
    // Qayta tekshirish — eski ishlarni o'chirib PENDING qilamiz (dublikat chiqmasin).
    await prisma.mibCase.deleteMany({ where: { clientId: client.id } });
    client = await prisma.mibClient.update({
      where: { id: client.id },
      // holat=MANUAL_HOLAT — qo'lda qayta tekshirilgan Excel mijozi ham Excel qayta qurishda o'chmasin.
      data: { status: 'PENDING', error: null, checkedAt: null, attempts: 0, holat: MANUAL_HOLAT, ...(fio ? { fio } : {}) },
    });
  } else {
    client = await prisma.mibClient.create({ data: { reportId, pinfl, fio: fio ?? null, holat: MANUAL_HOLAT, status: 'PENDING' } });
  }

  const total = await prisma.mibClient.count({ where: { reportId } });
  await prisma.mibReport.update({ where: { id: reportId }, data: { total } });

  const started = await startMibRun(reportId);
  return { ok: true, clientId: client.id, running: !!started || isMibRunActive(reportId) };
}
