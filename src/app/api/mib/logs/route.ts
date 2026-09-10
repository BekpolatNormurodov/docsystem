import { NextRequest, NextResponse } from 'next/server';
import { requireAccess } from '@/lib/auth';
import { getMibLogs } from '@/lib/mib/log-buffer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?after=<id>&q=<substring> — MIB avtomator loglarining jonli quyrug'i (in-process bufer).
// `q` — masalan mijoz PINFL'i (o'sha PINFL bo'yicha loglarni ajratish).
export async function GET(req: NextRequest) {
  await requireAccess('mib-report');
  const after = Number(req.nextUrl.searchParams.get('after')) || 0;
  const q = req.nextUrl.searchParams.get('q') || undefined;
  return NextResponse.json(getMibLogs(after, q));
}
