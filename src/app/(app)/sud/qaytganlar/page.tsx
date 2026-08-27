import { requireAccess } from '@/lib/auth';
import { loadStageData } from '../../konveyer/stage-data';
import { CabinetReturns } from '../../konveyer/CabinetReturns';

export const dynamic = 'force-dynamic';

// Sud → «Qaytganlar» — cabinet.sud.uz OUTCOME = RETURNED/REFUSED/UNCONSIDERED (the real court
// returns). Yagona ixcham ro'yxat: rangli natija filtrlari + qidiruv + har ishni ochib «asosiy
// sabab» va tavsiya. Qayta topshirish cabinet.sud.uz da bajariladi. (Avvalgi ikkinchi, stage-asosli
// CourtManager «returns» bloki olib tashlandi — takror emas, yagona manba.)
export default async function SudQaytganlarPage({ searchParams }: { searchParams: { s?: string } }) {
  await requireAccess('sud:returns');
  const d = await loadStageData('COURT', searchParams.s);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Sud — qaytganlar</h1>
      <CabinetReturns snapshotId={d.selectedId} />
    </div>
  );
}
