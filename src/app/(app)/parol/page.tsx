import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/ui';
import { roleLabel } from '@/lib/access';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function ParolPage() {
  const me = await requireUser();
  return (
    <div>
      <PageHeader title="Parol" subtitle="Hisobingiz parolini o‘zgartiring" />
      <PasswordForm username={me.username} fullName={me.fullName} roleLabel={roleLabel(me.role)} />
    </div>
  );
}
