import { prisma } from '@/lib/db';

// Poll a Job row until it reaches a terminal state (DONE/FAILED) or the timeout elapses. Used by the
// single-case GET routes to wait for the background worker (JOB_MODE=worker) — or the inline runner —
// to finish producing exports/{jobId}.zip, so the web process itself never launches chromium.
export async function awaitJob(jobId: number, timeoutMs = 280_000): Promise<'DONE' | 'FAILED' | 'TIMEOUT'> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const j = await prisma.job.findUnique({ where: { id: jobId }, select: { status: true } });
    if (j?.status === 'DONE') return 'DONE';
    if (j?.status === 'FAILED') return 'FAILED';
    if (Date.now() > deadline) return 'TIMEOUT';
    await new Promise((r) => setTimeout(r, 500));
  }
}
