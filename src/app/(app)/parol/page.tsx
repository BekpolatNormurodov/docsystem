import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/ui';
import { roleLabel } from '@/lib/access';
import { getT } from '@/lib/i18n/server';
import { PasswordForm } from './PasswordForm';

export const dynamic = 'force-dynamic';

export default async function ParolPage() {
  const t = getT();
  const me = await requireUser();
  return (
    <div>
      <PageHeader title={t('Parol')} subtitle={t('Hisobingiz parolini o‘zgartiring')} />
      <PasswordForm username={me.username} fullName={me.fullName} roleLabel={roleLabel(me.role)} />
    </div>
  );
}
