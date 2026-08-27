import { requireAccess } from '@/lib/auth';
import { PalataScanPanel } from '../../konveyer/PalataScanPanel';

export const dynamic = 'force-dynamic';

// Sanoat palatasi → «Arizalarni skanerlash» sub-item. SCANNING WORK ONLY: upload the
// signed scans returned from the chamber, OCR them, and save each client's ariza as
// its own PDF into the case (bazaga). The ariza-generation / case list / advance flow
// lives on the sibling «Arizani tayyorlash» page (/ariza) — only the ariza is sent to
// the chamber, so this page stays focused on the scan-back step.
export default async function ArizaSkanerPage() {
  await requireAccess('ariza:scan');
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold tracking-tight">Sanoat palatasi — arizalarni skanerlash</h1>
      <PalataScanPanel />
    </div>
  );
}
