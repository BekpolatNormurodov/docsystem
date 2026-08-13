import 'dotenv/config';
import { prisma } from '../lib/db';
import { runJobById } from '../lib/job-runner';

// Standalone background worker. Runs in its own process (a Docker container in production) and is the
// ONLY executor of the heavy document jobs when the web app runs with JOB_MODE=worker. It polls the
// Job table, atomically claims one PENDING job at a time, and runs it to completion via the shared
// runJobById() — the exact same code path the web process uses inline. Chromium (playwright) lives
// here, off the request server.
//
// Only PACKET/OFERTA/TALABNOMA are claimed. IMPORT stays on the web process (it needs the just-
// uploaded temp file in ./uploads); the worker never touches it.
const DOC_TYPES = ['PACKET', 'OFERTA', 'TALABNOMA'] as const;
const POLL_MS = 2000;
// A RUNNING doc-job whose progress hasn't advanced in this long is treated as orphaned (its worker
// died). Job.updatedAt is only bumped once per CONCURRENCY-sized render batch, so this MUST stay well
// above the worst-case gap between those per-batch writes — otherwise a slow-but-live batch under
// chromium contention could be mistaken for a dead worker. Run ONE worker instance (see WORKER.md):
// with a single worker the startup sweep only ever sees genuinely-orphaned jobs (this worker holds
// none yet); a second concurrent instance is the only way a live job could be wrongly failed, and the
// Docker service pins container_name so an accidental `--scale worker=2` errors out.
const STALE_MS = 15 * 60_000;

let stopping = false;

// Atomically claim the oldest PENDING doc-job: flip PENDING→RUNNING and only proceed if THIS update
// won the row (count === 1). Guards against two workers grabbing the same job.
async function claimNext(): Promise<number | null> {
  const job = await prisma.job.findFirst({
    where: { status: 'PENDING', type: { in: DOC_TYPES as unknown as string[] } },
    // FIX 2 (queue priority): smallest job first (total = doc count), then oldest. A quick interactive
    // single-case download (total 1) must not wait behind a huge bulk batch (total ~1671) queued just
    // before it — that starvation is what times out the route's awaitJob. Ties break by createdAt (FIFO).
    // NB: a bulk job ALREADY RUNNING can't be preempted; this only reorders what's still PENDING.
    orderBy: [{ total: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!job) return null;
  const claimed = await prisma.job.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'RUNNING' } });
  return claimed.count > 0 ? job.id : null; // lost the race → caller retries next tick
}

// One-time, at startup: a doc-job left RUNNING with no fresh progress (updatedAt older than STALE_MS)
// has no live worker — it was orphaned by a crashed/killed worker or an old inline run the dev server
// abandoned. Mark it FAILED (not PENDING): these jobs restart from scratch anyway, and silently
// re-running a huge abandoned batch (e.g. a 1671-case packet) on every worker start is surprising and
// expensive. The user re-triggers from the UI if they still want the output. A genuinely in-flight job
// updates its progress per batch, so it is never this stale and is left alone.
async function failStaleOrphans(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_MS);
  const res = await prisma.job.updateMany({
    where: { status: 'RUNNING', type: { in: DOC_TYPES as unknown as string[] }, updatedAt: { lt: cutoff } },
    data: { status: 'FAILED', message: 'Ishchi jarayon uzilgan — bu job yarim yoʻlda toʻxtagan. Qayta ishga tushiring.' },
  });
  if (res.count > 0) console.log(`[worker] marked ${res.count} orphaned RUNNING job(s) FAILED`);
}

// FIX 4: how often the idle poll loop re-runs the orphan sweep (~5 min). The startup sweep alone misses
// a job left RUNNING by a mid-render restart: at boot it is younger than STALE_MS and thus skipped, and
// nothing rechecks it afterward. Re-sweeping on idle eventually fails it once it ages past STALE_MS.
const ORPHAN_SWEEP_MS = 5 * 60_000;

async function loop(): Promise<void> {
  console.log('[worker] started — polling PENDING PACKET/OFERTA/TALABNOMA jobs every', POLL_MS, 'ms');
  await failStaleOrphans().catch((e) => console.error('[worker] orphan sweep failed', e));
  let lastSweep = Date.now();
  while (!stopping) {
    try {
      const id = await claimNext();
      if (id != null) {
        console.log(`[worker] running job ${id}`);
        const t0 = Date.now();
        await runJobById(id).catch((e) => console.error(`[worker] job ${id} threw`, e));
        console.log(`[worker] job ${id} finished in ${Math.round((Date.now() - t0) / 1000)}s`);
        continue; // immediately look for the next job (no idle wait)
      }
    } catch (e) {
      console.error('[worker] poll error', e);
    }
    // Periodic re-sweep (idle only — a busy worker is inside runJobById above). STALE_MS is unchanged,
    // so a genuinely-live long job (progress bumped per batch) is never mistaken for an orphan.
    if (Date.now() - lastSweep >= ORPHAN_SWEEP_MS) {
      lastSweep = Date.now();
      await failStaleOrphans().catch((e) => console.error('[worker] periodic orphan sweep failed', e));
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await prisma.$disconnect().catch(() => {});
  console.log('[worker] stopped');
}

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    if (stopping) return;
    console.log(`[worker] ${sig} — finishing current job then exiting`);
    stopping = true;
  });
}

loop().catch((e) => {
  console.error('[worker] fatal', e);
  process.exit(1);
});
