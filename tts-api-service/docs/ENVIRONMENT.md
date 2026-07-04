# tts-api-service — Environment Variable Reference

All variables are validated once at startup in `src/config/env.ts`. Feature code
imports the typed `env` object; it must never read `process.env` directly
(skills.md). Secrets are never logged. See `.env.example` for a copy-paste template.

## Runtime

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `NODE_ENV` | no | `development` | Runtime mode. |
| `PORT` | no | `3000` | API HTTP port. |
| `LOG_LEVEL` | no | `info` | Pino log level. |

## PostgreSQL — durable source of truth

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string (Prisma). |

## Redis — execution queue only

| Variable | Required | Purpose |
|---|---|---|
| `REDIS_URL` | yes | Redis connection (BullMQ + rate-limit store). |

## BullMQ queue (Phase 6)

| Variable | Default | Purpose |
|---|---|---|
| `TTS_QUEUE_NAME` | `tts-generation-queue` | Queue name. |
| `QUEUE_MAX_ATTEMPTS` | `3` | Max processing attempts before `failed`. |
| `QUEUE_BACKOFF_TYPE` | `exponential` | `exponential` or `fixed`. |
| `QUEUE_BACKOFF_DELAY_MS` | `5000` | Base backoff delay. |
| `QUEUE_JOB_TIMEOUT_MS` | `120000` | Per-job timeout. |
| `WORKER_CONCURRENCY` | `1` | Worker concurrency (1–2). |

## Model server (indicf5-model-server)

| Variable | Required | Purpose |
|---|---|---|
| `MODEL_SERVER_URL` | yes | Base URL of the Python model server. |
| `MODEL_SERVER_INTERNAL_TOKEN` | yes | Shared secret sent as `X-Internal-Token`. Must equal the model server's `INTERNAL_TOKEN`. |
| `MODEL_SERVER_TIMEOUT_MS` | no (`120000`) | HTTP timeout for generate calls. |
| `MODEL_SERVER_MAX_RETRIES` | no (`3`) | Retry budget for model/network failures. |

## Audio storage (MinIO / S3)

| Variable | Required | Purpose |
|---|---|---|
| `S3_ENDPOINT` | yes | S3-compatible endpoint (MinIO in dev). |
| `S3_REGION` | yes | Region string. |
| `S3_BUCKET` | yes | Bucket for WAV objects. |
| `S3_ACCESS_KEY_ID` | yes | Access key. |
| `S3_SECRET_ACCESS_KEY` | yes | Secret key. |
| `S3_FORCE_PATH_STYLE` | no (`true`) | Required `true` for MinIO. |
| `AUDIO_URL_EXPIRY_SECONDS` | no (`3600`) | Presigned download URL lifetime. |

## Email (SMTP / Nodemailer)

| Variable | Required | Purpose |
|---|---|---|
| `SMTP_HOST` | yes | SMTP host (MailHog in dev). |
| `SMTP_PORT` | yes | SMTP port (`1025` for MailHog). |
| `SMTP_SECURE` | no (`false`) | TLS on connect. |
| `SMTP_USER` / `SMTP_PASS` | no | SMTP credentials (empty for MailHog). |
| `EMAIL_FROM` | yes | From header. |

## Limits & backpressure (Phase 13)

| Variable | Default | Purpose |
|---|---|---|
| `MAX_TEXT_LENGTH` | `5000` | Chars; exceeding returns `413`. |
| `MAX_PENDING_JOBS_PER_USER` | `20` | Exceeding returns `429`. |
| `GLOBAL_QUEUE_MAX` | `1000` | Queue full returns `503`. |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window; per-user rate lives in `users.rate_limit_per_minute`. |

## Security

| Variable | Required | Purpose |
|---|---|---|
| `API_KEY_PEPPER` | yes | Server-side pepper mixed into `api_key_hash`. |

## Redis disaster recovery (Phase 9)

| Variable | Default | Purpose |
|---|---|---|
| `RECOVERY_ENABLED` | `true` | Toggle recovery service. |
| `RECOVERY_INTERVAL_MS` | `120000` | Periodic scan interval. |
| `STALE_PROCESSING_TIMEOUT_MS` | `180000` | Processing older than this is re-enqueued. |

## Incident alerting (Phase 10)

| Variable | Default | Purpose |
|---|---|---|
| `ALERT_SLACK_WEBHOOK_URL` | — | Slack incoming webhook. |
| `ALERT_EMAIL_TO` | — | On-call email. |
| `SENTRY_DSN` | — | Optional log-event sink. |
| `FAILURE_RATE_WINDOW_MS` | `300000` | Window for failure-rate alert. |
| `FAILURE_RATE_THRESHOLD` | `10` | Failures in window before alert. |
| `QUEUE_BACKLOG_THRESHOLD` | `500` | Waiting jobs before alert. |
| `STUCK_JOB_THRESHOLD_MS` | `300000` | Processing duration before "stuck job" alert. |
