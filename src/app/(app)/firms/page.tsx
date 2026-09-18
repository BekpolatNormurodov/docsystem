import { prisma } from '@/lib/db';
import { PageHeader, Table } from '@/ui';
import { getT } from '@/lib/i18n/server';
import { FirmRow } from './FirmForm';

export const dynamic = 'force-dynamic';

export default async function FirmsPage() {
  const t = getT();
  // Admin sahifasi HAMMA firmani ko'rsatadi (nofaollar ham — qayta yoqish uchun). Faol birinchi.
  const firms = await prisma.firm.findMany({ orderBy: [{ active: 'desc' }, { code: 'asc' }] });
  const activeCount = firms.filter((f) => f.active).length;

  return (
    <div>
      <PageHeader title={t('Firmalar')} subtitle={`${t('Jami')}: ${firms.length} ${t('ta')} · ${t('faol')}: ${activeCount}`} />
      <Table
        head={
          <tr>
            <th className="px-4 py-3 text-left font-medium">{t('Kod')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('Nomi')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('STIR')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('X/R')}</th>
            <th className="px-4 py-3 text-left font-medium">{t('Holat')}</th>
            <th className="px-4 py-3"></th>
          </tr>
        }
      >
        {firms.map((f) => (
          <FirmRow key={f.id} firm={f} />
        ))}
      </Table>
    </div>
  );
}
