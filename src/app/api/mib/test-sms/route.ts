import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAccess } from '@/lib/auth';
import { confirmPendingPhone } from '@/lib/mib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// SMS-pipeline test WITHOUT a long-poll (which 504s behind nginx's 60s timeout). The client:
//   1. POST → get a baseline id (the newest MibSms right now).
//   2. GET ?after=<baseline> every few seconds until a NEW code (id > baseline) lands, then stops.
// A code arrives when the operator's phone forwards a test SMS to /api/mib-webhook.

// POST — start a test: return the current newest MibSms id as the baseline.
export async function POST() {
  await requireAccess('mib-report');
  const latest = await prisma.mibSms.findFirst({ orderBy: { id: 'desc' }, select: { id: true } });
  return NextResponse.json({ baselineId: latest?.id ?? 0 });
}

// GET ?after=<id> — quick check: the first unconsumed SMS newer than `after`. Marks it consumed.
//
// A real SMS landing here is ALSO the proof that a newly entered phone (+ its forwarder) works,
// so this is where a pending number is promoted to the live one. Saving the field alone never
// changes it — see the POST in ../config/route.ts.
export async function GET(req: NextRequest) {
  await requireAccess('mib-report');
  const after = Number(req.nextUrl.searchParams.get('after')) || 0;
  const row = await prisma.mibSms.findFirst({
    where: { id: { gt: after }, consumed: false },
    orderBy: { id: 'asc' },
  });
  if (!row) return NextResponse.json({ waiting: true });
  await prisma.mibSms.update({ where: { id: row.id }, data: { consumed: true } });
  const confirmedPhone = await confirmPendingPhone().catch(() => null);
  return NextResponse.json({ code: row.code, source: row.source, confirmedPhone });
}
