import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/ui';
import { CourtsAdmin } from './CourtsAdmin';

export const dynamic = 'force-dynamic';

// Admin: sudlar va kunlik limit boshqaruvi (Firmalar yonida). Har sud uchun limit/cutoff/ish-kunlari
// + billing «Sud id» + qaysi firmalar chiqadi; jonli kunlik sanoq. Firmani tanlab tartibli biriktirish.
export default async function SudlarPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader title="Sudlar" subtitle="Sudga yoʻnaltirish, kunlik limit va billing — bir joyda" />
      <CourtsAdmin />
    </div>
  );
}
