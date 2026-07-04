# tts-api-service — Architecture & Operations

This document covers the queue/worker model, retry strategy, Redis recovery,
incident alerting, production trade-offs, and why the model server is a separate
repository (plan.md Phase 14).

## Queue / worker model

The API is a thin edge process. On `POST /v1/tts/jobs` it validates, writes the
job to Postgres with `status=queued`, enqueues the `job_id` to BullMQ, and
returns `202` immediately — it never runs inference. A separate **worker**
process consumes `tts-generation-queue` and does the heavy work.

```
API (fast, stateless)  ──enqueue job_id──>  Redis / BullMQ  ──>  Worker (slow)
      │                                                              │
      └── writes Postgres (source of truth) <── status updates ──────┘
```

- The BullMQ payload is only `{ jobId }`. The worker reloads the authoritative
  record from Postgres and never trusts stale queue data.
- The BullMQ `jobId` equals the DB id, so an active job cannot be duplicated.
- `WORKER_CONCURRENCY` (default 1) bounds parallel inference calls.

## Retry strategy

- BullMQ is configured with `attempts=QUEUE_MAX_ATTEMPTS` (default 3) and
  exponential backoff (`QUEUE_BACKOFF_DELAY_MS`).
- The worker classifies each error (`workers/error-classifier.ts`):
  - **Retryable** (model timeout, network, model 5xx, unknown): on a non-final
    attempt the job is marked `retrying` and the processor **throws**, so BullMQ
    re-runs it with backoff.
  - **Non-retryable** (model `400` bad input, bad internal token): the job is
    marked `failed` immediately and the processor does **not** throw (no retry).
- On the final attempt, the job is marked `failed` (or `timeout`), a failure
  email is sent, and — for dependency failures — an incident alert is raised.
- Invariant: the processor throws **only** when it has set `status=retrying`, so
  Redis job state and the DB status stay in lock-step.

## Redis disaster-recovery strategy

Postgres is the source of truth; Redis is only the execution queue. If Redis
loses jobs (crash, flush), `recovery/recovery.service.ts` restores them. It runs
on worker/API startup and every `RECOVERY_INTERVAL_MS`.

For each unfinished job in Postgres:

| Postgres state | Redis state | Action |
|---|---|---|
| `queued` / `retrying` | missing | re-enqueue |
| `processing`, `updatedAt` older than `STALE_PROCESSING_TIMEOUT_MS` | missing | re-enqueue |
| `failed` / `timeout` with `retryCount < maxRetry` | missing | re-enqueue |
| any of the above | pending in Redis (`waiting/active/delayed`) | leave alone (no duplicate) |
| any of the above | finished artifact in Redis (`completed/failed`, retained) | remove artifact, then re-enqueue |
| `completed` | — | never touched |
| `failed` with `retryCount >= maxRetry` | — | never touched |

Idempotency comes from checking the BullMQ **state** before acting and from the
`jobId == dbId` de-dupe. A completed job is never re-generated (the worker also
early-returns if it reloads a `completed` record).

## Incident-alerting strategy

`alerts/incident-alert.service.ts` persists to `incident_alerts` and fans out to
channels (Slack webhook, structured log/Sentry-Datadog sink). Alerts are
**de-duplicated by fingerprint** so repeated failures of the same kind refresh
an open incident instead of spamming channels.

Triggers:

- Dependency failure that fails a job (model server down/timeout/unreachable, or
  a rejected internal token — a config error).
- High failure rate: `≥ FAILURE_RATE_THRESHOLD` failures within
  `FAILURE_RATE_WINDOW_MS`.
- Enqueue failure at submission time (queue/Redis issue).
- Email delivery failure (warning; never corrupts job status).
- `GET /health/dependencies` returning `degraded` (operational surface for the
  same conditions). Queue-backlog and stuck-job thresholds
  (`QUEUE_BACKLOG_THRESHOLD`, `STUCK_JOB_THRESHOLD_MS`) are configured for the
  monitoring layer.

## Why the model server is a separate repository

- **Runtime isolation:** IndicF5 needs Python, PyTorch, and (ideally) a GPU plus
  multi-GB model weights. The API/worker is a lightweight Node image. Splitting
  them keeps the API image small and fast to deploy.
- **Independent scaling:** inference is the bottleneck. The model server can be
  scaled on GPU nodes independently of the stateless API.
- **Blast-radius & security:** the model server is internal-only, reached over a
  private network with a shared `X-Internal-Token`. The public API never exposes
  it. A crash or slow model load degrades generation but doesn't take down job
  submission (jobs stay `queued` and are processed when the model recovers).
- **Clear contract:** the two sides communicate only through the documented HTTP
  contract, so either can be reimplemented without touching the other.

## Production trade-offs (current MVP choices)

- **Audio delivery:** `GET /v1/tts/jobs/:jobId/audio` streams the WAV through the
  API after an ownership check, rather than handing out presigned MinIO URLs.
  This avoids leaking storage hostnames and keeps authorization centralized, at
  the cost of API bandwidth. For scale, switch to presigned URLs from a
  publicly-resolvable S3 endpoint.
- **Submission during Redis outage:** the job is persisted (`queued`) and `202`
  is returned even if the immediate enqueue fails; recovery re-enqueues it. This
  favors durability/availability over instant queueing. An alternative is to
  gate submission on a Redis health check and return `503`.
- **`removeOnComplete/Fail=false`:** jobs are retained in Redis for inspection
  (per plan). In production, enable TTL-based removal to bound Redis memory;
  recovery already handles removing stale artifacts.
- **Rate limiting:** a per-user fixed-window counter in Redis (dynamic limit from
  `users.rate_limit_per_minute`). A sliding-window/token-bucket is more precise
  at burst boundaries.
- **Model concurrency:** inference is serialized per model-server process with a
  lock. Scale by running more model-server replicas behind the worker, not by
  raising in-process concurrency.
- **Secrets:** delivered via environment variables validated in `config/env.ts`.
  In production, source them from a secret manager and rotate the internal token.
