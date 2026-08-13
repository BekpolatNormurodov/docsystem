import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

// Liveness + readiness probe for Docker/compose healthchecks and the Nginx upstream.
// Exempted from auth in src/middleware.ts (otherwise the login redirect would mask the
// real status). Runs a trivial `SELECT 1` so a container is only "healthy" once it can
// actually reach MySQL — the web/worker `depends_on` gates and the load balancer rely on
// that. Never throws: a DB outage returns 503, not a 500 stack.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', db: 'up', ts: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { status: 'degraded', db: 'down', error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
