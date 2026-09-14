import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { bossReport } from '@/lib/boss-report';
import { BossReport } from './BossReport';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Boshliq (director) hisoboti — FAQAT admin. Firma × bosqich matritsasi, snapshot bo'yicha filtr
// (sidebardagi umumiy SnapshotPicker'ning konv_s cookiesi orqali — qo'shimcha ulanish shart emas).
export default async function Page() {
  await requireAdmin();
  const snaps = await konveyerSnapshots().catch(() => []);
  const raw = cookies().get('konv_s')?.value;
  const parsed = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const data = await bossReport(selectedId);
  const snapLabel = snaps.find((s) => s.id === selectedId)?.label ?? null;
  return <BossReport data={data} snapLabel={snapLabel} />;
}
