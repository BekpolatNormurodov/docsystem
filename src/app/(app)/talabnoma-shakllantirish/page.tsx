import { requireAccess } from '@/lib/auth';
import { TalabnomaForm } from './TalabnomaForm';

export const dynamic = 'force-dynamic';

// Standalone «Talabnoma shakllantirish» — sidebar eng pastida, Boshqaruv step'laridan alohida.
export default async function TalabnomaFormPage() {
  await requireAccess('talabnoma-form');
  return <TalabnomaForm />;
}
