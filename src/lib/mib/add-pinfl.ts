// Bitta PINFL qo'shib tekshirish mantig'i — HAM report ichidan (/api/mib/[id]/add-pinfl), HAM
// Excelsiz «Qo'lda tekshiruvlar» reportidan (/api/mib/check-pinfl) ishlatiladi. Natija ijro ishlari +
// tekshiruv sanasi bilan bazaga yig'ilib boradi (mavjud avtomator loopi orqali).
//
// QAYTA TEKSHIRISH (2026-09-23): bir xil PINFL ikkinchi marta kelганda ilgari `deleteMany` bilan eski
// natija YO'QOLARDI — user shikoyati: «orqaga qolsin arxivда». Endi:
//   - force=false (default): mavjud mijozni QAYTARADI — reused=true + lastCheckedAt. UI dialog ko'rsatib
//     foydalanuvchidan «yangi dalniy olish»ни so'raydi.
//   - force=true: eski ishlar ARXIVLANADI (archivedAt=now, o'chirilmaydi) va mijoz PENDINGга tushib
//     qaytadan tekshiriladi. Eski nusxa `?archived=1` bilan ko'rish mumkin.
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

export type AddPinflResult =
  | { ok: true; clientId: number; running: boolean; reused?: false }
  | { ok: true; clientId: number; running: boolean; reused: true; lastCheckedAt: Date | null; cases: number }
  | { ok: false; error: string };

export async function addPinflAndCheck(
  reportId: number,
  pinflRaw: string,
  fio?: string | null,
  opts?: { force?: boolean },
): Promise<AddPinflResult> {
  const pinfl = String(pinflRaw ?? '').replace(/\D/g, '');
  if (pinfl.length !== 14) return { ok: false, error: 'PINFL 14 ta raqamdan iborat boʻlishi kerak' };
  const force = !!opts?.force;

  let client = await prisma.mibClient.findFirst({ where: { reportId, pinfl } });
  if (client) {
    // Jonli avtomator shu reportда ISHLAYOTGAN bo'lsa — hech narsani o'chirmaymiz/reset qilmaymiz.
    // Aks holda ketayotgan run yaratgan ish o'chib, u mibCase.update'да «record not found»ga uchraydi.
    if (isMibRunActive(reportId)) {
      return { ok: true, clientId: client.id, running: true };
    }
    if (!force) {
      // DEFAULT — eski natijani QAYTARADI (yo'qotmaymiz). UI dialog ko'rsatadi.
      const activeCases = await prisma.mibCase.count({ where: { clientId: client.id, archivedAt: null } });
      return { ok: true, clientId: client.id, running: false, reused: true, lastCheckedAt: client.checkedAt, cases: activeCases };
    }
    // FORCE — eski faol ishlar ARXIVLANADI (o'chirilmaydi — dinamika ko'rinsin), mijoz PENDING.
    await prisma.mibCase.updateMany({ where: { clientId: client.id, archivedAt: null }, data: { archivedAt: new Date() } });
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
