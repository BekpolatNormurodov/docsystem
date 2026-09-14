import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/ui';
import { getT } from '@/lib/i18n/server';
import { CourtsAdmin } from './CourtsAdmin';

export const dynamic = 'force-dynamic';

// Admin: sudlar va kunlik limit boshqaruvi (Firmalar yonida). Har sud uchun limit/cutoff/ish-kunlari
// + billing «Sud id» + qaysi firmalar chiqadi; jonli kunlik sanoq. Firmani tanlab tartibli biriktirish.
export default async function SudlarPage() {
  await requireAdmin();
  const t = getT();
  return (
    <div>
      <PageHeader title={t('Sudlar')} subtitle={t('Sudga yoʻnaltirish, kunlik limit va billing — bir joyda')} />
      <CourtsAdmin />
    </div>
  );
}
