import { cookies } from 'next/headers';
import { requireAccess } from '@/lib/auth';
import { konveyerSnapshots } from '@/lib/konveyer';
import { buxgalteriyaData } from '@/lib/buxgalteriya';
import { PageHeader } from '@/ui';
import { BuxgalteriyaList } from './BuxgalteriyaList';

export const dynamic = 'force-dynamic';

export default async function BuxgalteriyaPage() {
  await requireAccess('buxgalteriya');

  // Sana — sidebardagi bir xil snapshot cookie (konv_s), butun ilovadagidek.
  const snaps = await konveyerSnapshots().catch(() => [] as Awaited<ReturnType<typeof konveyerSnapshots>>);
  const raw = cookies().get('konv_s')?.value;
  const parsed = raw ? Number(raw) : NaN;
  const selectedId = Number.isInteger(parsed) && parsed > 0 && snaps.some((s) => s.id === parsed) ? parsed : snaps[0]?.id;
  const sel = snaps.find((s) => s.id === selectedId);

  const data = await buxgalteriyaData(selectedId);

  return (
    <div>
      <PageHeader
        title="Buxgalteriya"
        subtitle={`Yaratilgan boji invoice'lari — firmalar bo'yicha, holati bilan${sel ? ` · ${sel.label}` : ''}`}
      />
      <BuxgalteriyaList data={data} />
    </div>
  );
}
