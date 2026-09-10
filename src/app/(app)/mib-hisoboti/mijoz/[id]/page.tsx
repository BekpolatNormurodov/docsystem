import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { ClientDetailFull } from '../../ClientDetailFull';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Bitta mijozning to'liq ijro-ishlari sahifasi (/mib-hisoboti/mijoz/<clientId>). Ma'lumot va jonli
// yangilanish ClientDetailFull ichida /api/mib/client/[cid] dan keladi.
export default async function Page({ params }: { params: { id: string } }) {
  await requireAccess('mib-report');
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const client = await prisma.mibClient.findUnique({ where: { id }, select: { reportId: true } });
  if (!client) notFound();
  return (
    <div className="p-4 sm:p-6">
      <ClientDetailFull reportId={client.reportId} clientId={id} backHref={`/mib-hisoboti?report=${client.reportId}`} />
    </div>
  );
}
