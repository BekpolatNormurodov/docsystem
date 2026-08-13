import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';

// GET ?snapshotId=&firmId= — finished «Ariza yaratish» (arizaOnly) jobs for the scope,
// newest first, so the Arizani-tayyorlash panel can show a re-downloadable history
// («tayyorlanganlar»). Download/delete reuse /api/export/{jobId}[/download].
export async function GET(req: NextRequest) {
  await requireUser();
  const sp = req.nextUrl.searchParams;
  const snapshotId = Number(sp.get('snapshotId')) || undefined;
  const firmId = Number(sp.get('firmId')) || undefined;

  const jobs = await prisma.job.findMany({
    where: { type: 'PACKET', status: 'DONE', resultPath: { not: null }, ...(snapshotId ? { snapshotId } : {}) },
    orderBy: { id: 'desc' },
    take: 60,
    select: { id: true, total: true, createdAt: true, resultPath: true, params: true },
  });
  const firms = await prisma.firm.findMany({ select: { id: true, shortName: true } });
  const nameOf = new Map(firms.map((f) => [f.id, f.shortName]));

  const items = jobs
    .filter((j) => {
      const p = (j.params ?? {}) as Record<string, unknown>;
      if (p.arizaOnly !== true) return false;                        // only the ariza-tayyorlash jobs
      if (firmId != null && Number(p.firmId) !== firmId) return false; // scope to the picked firm
      return true;
    })
    .slice(0, 25)
    .map((j) => {
      const p = (j.params ?? {}) as Record<string, unknown>;
      const fid = p.firmId != null ? Number(p.firmId) : null;
      let size = 0;
      try { size = fs.statSync(path.join(process.cwd(), j.resultPath as string)).size; } catch { /* file gone */ }
      return {
        id: j.id,
        total: j.total,
        createdAt: j.createdAt.toISOString(),
        firmName: fid != null ? (nameOf.get(fid) ?? `firma ${fid}`) : 'Hamma firma',
        size,
      };
    });
  return NextResponse.json({ items });
}
