import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/ui';
import { CourtSettings } from '../settings/CourtSettings';
import { FirmCourtAssign } from './FirmCourtAssign';

export const dynamic = 'force-dynamic';

// Admin: sudlar va kunlik limit boshqaruvi (Firmalar yonida). Firmani tanlab sud biriktiriladi;
// har sud uchun limit/cutoff/ish-kunlari belgilanadi.
export default async function SudlarPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader title="Sudlar" subtitle="Sudga yo‘naltirish va kunlik limit — firmani tanlab biriktiring" />
      <div className="space-y-4">
        <FirmCourtAssign />
        <CourtSettings />
      </div>
    </div>
  );
}
