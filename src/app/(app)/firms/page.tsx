import { prisma } from '@/lib/db';
import { PageHeader, Table } from '@/ui';
import { FirmRow } from './FirmForm';

export const dynamic = 'force-dynamic';

export default async function FirmsPage() {
  const firms = await prisma.firm.findMany({ orderBy: { code: 'asc' } });

  return (
    <div>
      <PageHeader title="Firmalar" subtitle={`Jami: ${firms.length} ta`} />
      <Table
        head={
          <tr>
            <th className="px-4 py-3 text-left font-medium">Kod</th>
            <th className="px-4 py-3 text-left font-medium">Nomi</th>
            <th className="px-4 py-3 text-left font-medium">STIR</th>
            <th className="px-4 py-3 text-left font-medium">X/R</th>
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
