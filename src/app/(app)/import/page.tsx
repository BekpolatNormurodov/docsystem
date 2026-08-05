import { requireAdmin } from '@/lib/auth';
import { PageHeader } from '@/ui';
import { ImportForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  await requireAdmin();

  return (
    <div>
      <PageHeader title="Import" subtitle="Portfel faylini yuklang" />
      <ImportForm />
    </div>
  );
}
