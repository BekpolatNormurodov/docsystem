import { requireAccess } from '@/lib/auth';
import { loadStageData } from '../../konveyer/stage-data';
import { BuxgalterPanel } from '../../konveyer/BuxgalterPanel';

export const dynamic = 'force-dynamic';

// «Invoice yaratish» — Sud qadamining birinchi sub-step'i. Har mijozning davlat boji invoice'i
// billing.sud.uz dan yaratiladi (raqam + PDF), arizasiga bogʻlanadi (ArizaCase.receiptNumber) va
// buxgalterga ZIP (PDF'lar + Hisobot.xlsx) boʻlib beriladi — buxgalter toʻlaydi. Ariza bojisiz
// qoladi; invoice raqami ariza bilan sudga ketadi.
export default async function SudInvoicePage() {
  await requireAccess('sud:invoice');
  const d = await loadStageData('COURT');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Invoice yaratish</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Har mijozga davlat boji invoice'i billing.sud.uz dan yaratiladi (raqam + PDF), arizasiga
          bogʻlanadi va buxgalterga ZIP (PDF'lar + Hisobot.xlsx) boʻlib beriladi. Har firma alohida,
          bir martada ≤100 ta. Toʻlangach invoice raqami ariza bilan sudga ketadi.
        </p>
      </div>
      <BuxgalterPanel snapshotId={d.selectedId} />
    </div>
  );
}
