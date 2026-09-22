import { cookies } from 'next/headers';
import { requireAccess } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { konveyerSnapshots } from '@/lib/konveyer';
import { bossReport } from '@/lib/boss-report';
import { BossReport } from './BossReport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Boshliq (director) hisoboti — ADMIN yoki 'boss-report' moduli berilgan YURIST (boshliq). Firma ×
// bosqich matritsasi, snapshot bo'yicha filtr (sidebardagi umumiy SnapshotPicker'ning konv_s cookiesi
// orqali — qo'shimcha ulanish shart emas).
export default async function Page() {
  await requireAccess('boss-report');
  const snaps = await konveyerSnapshots().catch(() => []);
  const raw = cookies().get('konv_s')?.value;
  const parsed = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const data = await bossReport(selectedId);
  const snapLabel = snaps.find((s) => s.id === selectedId)?.label ?? null;
  // Mijoz-holati qidiruvidagi kartochka havolasi uchun (/s/<sana>/p/<pinfl>) — eng so'nggi portfel sanasi.
  const latest = await prisma.snapshot.findFirst({ where: { status: 'READY' }, orderBy: { reportDate: 'desc' }, select: { reportDate: true } });
  const linkDate = latest ? latest.reportDate.toISOString().slice(0, 10) : '';
  // Mijoz-holati (firma · bosqich) eksporti — matritsa Excel'idan tashqari, kishi darajasida.
  const statusExcelHref = `/mijozlar/status-excel${selectedId ? `?s=${selectedId}` : ''}`;
  // Hisobot QACHON hisoblangani (server vaqti) — tepadagi «Yangilanish vaqti» rozetkasi uchun.
  // force-dynamic bo'lgani uchun har so'rov (va har avtomatik yangilanish)da yangilanadi.
  const generatedAt = new Date().toISOString();
  return <BossReport data={data} snapLabel={snapLabel} linkDate={linkDate} statusExcelHref={statusExcelHref} generatedAt={generatedAt} />;
}
