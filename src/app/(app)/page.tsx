import { PageHeader, EmptyState } from '@/ui';

export const dynamic = 'force-dynamic';

export default function Dashboard() {
  return (
    <div>
      <PageHeader title="Kalendar" />
      <EmptyState title="Hali portfel yuklanmagan — Import bo'limidan yuklang" />
    </div>
  );
}
