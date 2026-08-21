import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET — history: every batch (newest first) with its runs. The client opens saved files from here.
export async function GET() {
  await requireAdmin();
  const batches = await prisma.talabnomaFormBatch.findMany({
    orderBy: { id: 'desc' },
    include: { runs: { orderBy: { id: 'desc' } } },
  });
  return NextResponse.json({ batches });
}
