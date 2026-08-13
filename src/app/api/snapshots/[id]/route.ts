import fs from 'node:fs/promises';
import path from 'node:path';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { audit, AuditAction } from '@/lib/audit';

export const runtime = 'nodejs';

// Delete a snapshot: its loans cascade, and the uploaded portfolio + exclusion files are removed.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: 'id notoʻgʻri' }, { status: 400 });

  const snap = await prisma.snapshot.findUnique({ where: { id } });
  if (!snap) return NextResponse.json({ error: 'topilmadi' }, { status: 404 });

  await prisma.snapshot.delete({ where: { id } }); // Loan rows cascade via the relation
  await audit(AuditAction.SNAPSHOT_DELETE, { target: `snapshot:${id}`, detail: { sourceFileName: snap.sourceFileName, rowCount: snap.rowCount } });

  const uploads = path.join(process.cwd(), 'uploads');
  await Promise.all([
    fs.rm(path.join(uploads, `${id}.xlsx`), { force: true }),
    fs.rm(path.join(uploads, `${id}-exclude.xlsx`), { force: true }),
  ]);

  return NextResponse.json({ ok: true });
}
