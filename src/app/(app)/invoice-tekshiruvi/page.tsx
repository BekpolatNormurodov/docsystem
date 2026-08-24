import { requireAdmin } from '@/lib/auth';
import { InvoiceCheck } from './InvoiceCheck';

export const dynamic = 'force-dynamic';

// Standalone «Invoice tekshiruvi» — sidebar eng pastida, Boshqaruv step'laridan alohida.
// billing.sud.uz: bitta kvitansiya raqami bo'yicha yoki firma STIR bo'yicha ro'yxat.
export default async function InvoiceTekshiruviPage() {
  await requireAdmin();
  return <InvoiceCheck />;
}
