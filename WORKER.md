# Background worker

Heavy document jobs — **to'liq paket / ariza (PACKET)**, **oferta (OFERTA)**, **talabnoma PDF
(TALABNOMA)** — render dozens of PDFs with chromium (Playwright). By default the **web process** runs
them in-process (fire-and-forget). Under load that competes with request handling.

The worker lets those jobs run in a **separate process** instead. The web only creates the `Job` row
(status `PENDING`) and returns immediately; the worker polls the `Job` table, atomically claims one job
(`PENDING → RUNNING`), and runs it via the **same** code path (`runJobById`). The client polls
`/api/jobs/{id}` and downloads the ZIP when `DONE` — unchanged.

`IMPORT` always stays on the web process (it needs the just-uploaded temp file); the worker ignores it.

## How it's wired

- `src/lib/job-runner.ts` — `runJobById(jobId)`: reconstructs a job from its persisted `type` + `params`
  and runs the matching runner. One source of truth for both modes.
- `src/lib/job-dispatch.ts` — `enqueueJob(jobId)`: **inline** (default) runs it in-process now;
  **worker** (`JOB_MODE=worker`) leaves it `PENDING` for the worker. The four document routes call this.
- `src/worker/index.ts` — the poll/claim/run loop. At startup it marks stale orphaned `RUNNING`
  doc-jobs (no progress for >15 min → a crashed worker or an abandoned inline run) as `FAILED`, so the
  UI stops showing them as running; re-trigger from the UI to run them again.

**Run exactly one worker instance.** The startup orphan-sweep assumes it is the sole executor. Two
concurrent workers could let one's startup sweep wrongly fail the other's in-flight job. The Docker
service pins `container_name`, so `docker compose --scale worker=2` errors out; if you run the same-host
worker, don't start `npm run worker` twice.

**Non-breaking:** with `JOB_MODE` unset, behaviour is exactly as before.

## Run it — same host (recommended on Windows)

The web app currently stores firm-doc / scan file paths as **absolute host paths**, so the worker must
see the same filesystem. On your setup that means running it as a second process on the same machine:

1. Set `JOB_MODE=worker` in the web app's `.env` (so routes enqueue instead of running inline).
2. Restart the web app (`npm run dev`).
3. In a second terminal, start the worker (same `.env`, same DB, same disk):

```bash
npm run worker
```

Heavy jobs now run in the worker process; the web server stays responsive. Stop with Ctrl-C (it
finishes the current job first).

## Run it — Docker (full-Linux production deployment)

In production the whole stack is containerized — see **[DEPLOYMENT.md](DEPLOYMENT.md)**. Two images:
`web` is **lean** (`Dockerfile`, node-slim, **no chromium**) and `worker` carries chromium
(`Dockerfile.worker`, Playwright base); the one-shot `migrate` reuses the worker image. `JOB_MODE=worker`
is set on both app services, so the `worker` container is the **sole** chromium executor — it renders
BOTH the bulk batches AND the single-case PDFs (the per-case `gen-packet`/`gen-oferta`/`gen-talabnoma`
routes now create a one-case job, wait for the worker, and stream the result, instead of launching
chromium on the web process). All services share the `./exports`, `./uploads`, `./storage`, `./data`
bind mounts, so the worker sees the same filesystem as web.

```bash
./scripts/deploy.sh      # build + DB + migrate/seed + web/worker + nginx/SSL
```

**Migrating existing Windows data:** `FirmDocument.filePath` / `CaseDocument.filePath` rows written on
Windows hold **absolute** `C:\…` paths a Linux container can't resolve, so re-uploaded/migrated firm
docs must be re-pointed to `/app/exports/...`. A **fresh** server DB has no such rows and is unaffected
(new uploads write container-absolute `/app/...` paths that resolve consistently across web+worker).

**Single-case downloads share the worker queue.** The per-case `gen-packet`/`gen-oferta`/`gen-talabnoma`
downloads enqueue a one-case job and wait for the worker. The worker claims **smaller jobs first**
(`orderBy: total asc`), so a single-case download normally jumps ahead of a queued bulk batch. But the
worker runs **one job at a time and cannot preempt** — if a large bulk batch is already mid-render, a
single-case download waits and, past the ~280s poll window, returns a "navbatda — qayta urinib ko'ring"
(queued, retry) message; the document still finishes and is retrievable. Run bulk batches when nobody
needs instant single-case downloads, or (future) add a second dedicated worker.
