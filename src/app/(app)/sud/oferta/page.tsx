import { requireAccess } from '@/lib/auth';
import { loadStageData } from '../../konveyer/stage-data';
import { OfertaBulk } from '../../konveyer/OfertaBulk';

export const dynamic = 'force-dynamic';

// Sud → «Oferta tayyorlash» sub-item — like Ariza yaratish (Sanoat palatasi), but renders the OFERTA
// (mikroqarz shartnomasi) PDFs: one per contract, grouped by client, into one ZIP. Firma yoki umumiy.
export default async function SudOfertaPage() {
  await requireAccess('sud:oferta');
  const d = await loadStageData('COURT');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Oferta tayyorlash</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Har mijozning har shartnomasiga oferta (mikroqarz shartnomasi) PDF yaratiladi va bitta ZIP
          (mijoz papkalari) boʻlib beriladi. Firma boʻyicha yoki umumiy · hammasi yoki belgilangan son.
        </p>
      </div>
      <OfertaBulk firms={d.firms} snapshotId={d.selectedId} />
    </div>
  );
}
