import { runJobById } from './job-runner';

// Where a queued Job actually runs. Default (JOB_MODE unset/"inline"): the web process runs it
// in-process, fire-and-forget — exactly the previous behaviour. With JOB_MODE=worker the web process
// only leaves the row PENDING and returns; the separate Docker worker (src/worker/index.ts) polls,
// claims and runs it — moving the heavy chromium work off the request server.
//
// The Job row must already be created (PENDING) before calling this. Non-breaking by construction:
// with no JOB_MODE set, every caller behaves as it did with its old `void runXxx()`.
export function enqueueJob(jobId: number): void {
  if (process.env.JOB_MODE === 'worker') return; // the worker will pick it up
  void runJobById(jobId).catch(() => {});
}
