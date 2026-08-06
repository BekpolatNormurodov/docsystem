import { prisma } from '@/lib/db';
import { PageHeader } from '@/ui';
import { InvoiceCreateForm } from './InvoiceCreateForm';
import { InvoiceList, type InvoiceRow } from './InvoiceList';

export const dynamic = 'force-dynamic';

export default async function InvoyslarPage() {
  const [firms, records] = await Promise.all([
    prisma.firm.findMany({ orderBy: { shortName: 'asc' }, select: { id: true, shortName: true, stir: true, region: true, district: true, addressLine: true } }),
    prisma.invoiceRecord.findMany({ orderBy: { createdAt: 'desc' }, take: 100, include: { firm: { select: { shortName: true } } } }),
  ]);

  const rows: InvoiceRow[] = records.map((r) => ({
    id: r.id,
    invoiceNo: r.invoiceNo,
    firmName: r.firm.shortName,
    paymentType: r.paymentType,
    amount: Number(r.amount).toLocaleString('ru-RU'),
    createdLabel: r.createdAt.toLocaleString('ru-RU'),
    hasPdf: !!r.pdfPath,
  }));

  return (
    <div>
      <PageHeader title="Invoice yaratish" subtitle="Firma tanlang, sonini kiriting — forma avtomat toʻldiriladi, «Robot emasman» va «Yaratish» ni oʻzingiz bosasiz" />
      <InvoiceCreateForm firms={firms} />
      <InvoiceList rows={rows} />
    </div>
  );
}
