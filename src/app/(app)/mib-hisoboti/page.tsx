import { requireAdmin } from '@/lib/auth';
import { MibReport } from './MibReport';

export const dynamic = 'force-dynamic';

// Standalone «MIB hisoboti» — sidebar eng pastida, Boshqaruv step'laridan alohida.
export default async function MibHisobotiPage() {
  await requireAdmin();
  return <MibReport />;
}
