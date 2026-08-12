import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';

// Only these columns may be edited — NEVER spread the raw body into update, which
// would let any Firm column be mass-assigned.
const EDITABLE = ['shortName', 'legalName', 'address', 'region', 'district', 'addressLine', 'bankAccount', 'mfo', 'stir', 'postIndex', 'phone'] as const;

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  await requireAdmin();
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'id notoʻgʻri' }, { status: 400 });
  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Notoʻgʻri soʻrov' }, { status: 400 }); }
  const b = (body ?? {}) as Record<string, unknown>;
  const data: Record<string, string | null> = {};
  for (const k of EDITABLE) if (k in b) data[k] = b[k] == null ? null : String(b[k]);
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Oʻzgartirish yoʻq' }, { status: 400 });
  try {
    const firm = await prisma.firm.update({ where: { id }, data });
    return NextResponse.json(firm);
  } catch (e) {
    // ONLY P2025 (no such id) is a real 404 — a transient DB error must surface as a
    // 5xx (retryable), not be masked as "firm deleted" and dropped from the UI.
    if ((e as { code?: string })?.code === 'P2025') return NextResponse.json({ error: 'Firma topilmadi' }, { status: 404 });
    throw e;
  }
}
