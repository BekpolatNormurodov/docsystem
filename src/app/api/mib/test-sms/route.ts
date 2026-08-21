import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const maxDuration = 120;

// POST — validate the SMS pipeline end-to-end: wait up to 90s for a NEW code to land at the webhook
// (operator sends a test SMS to the configured phone → forwarder POSTs it). Returns the code when it
// arrives, or a timeout. Marks it consumed so it isn't reused by the automator.
export async function POST() {
  await requireAdmin();
  const since = Date.now();
  const deadline = since + 90_000;
  while (Date.now() < deadline) {
    const row = await prisma.mibSms.findFirst({
      where: { consumed: false, createdAt: { gte: new Date(since) } },
      orderBy: { id: 'desc' },
    });
    if (row) {
      await prisma.mibSms.update({ where: { id: row.id }, data: { consumed: true } });
      return NextResponse.json({ ok: true, code: row.code, source: row.source });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return NextResponse.json({ ok: false, timeout: true }, { status: 408 });
}
