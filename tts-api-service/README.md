# tts-api-service

TypeScript backend for a Bengali text-to-speech platform. It exposes the public
API, authenticates callers, isolates jobs per user, persists jobs to PostgreSQL
(the durable source of truth), queues work in Redis/BullMQ, processes jobs in a
worker, recovers from Redis loss, sends email notifications, and raises incident
alerts.

> This service **never loads the AI model**. Inference happens only in the
> separate [`indicf5-model-server`](../indicf5-model-server) repo, reached over
> HTTP via `MODEL_SERVER_URL`.

## Architecture

```
Client ──(Bearer API key)──> API ──> Postgres (source of truth)
                              │
                              └──> Redis / BullMQ ──> Worker ──> model-server (HTTP)
                                                        │
                                                        ├──> Object storage (WAV)
                                                        ├──> Email notification
                                                        └──> Incident alerts
Recovery service: scans Postgres and re-enqueues lost/stale jobs.
```

Durability rule: Postgres is authoritative; Redis is only the execution queue.
If Redis loses jobs, the recovery service re-enqueues queued/stale/retrying jobs.

## Layering (skills.md)

```
route -> controller -> service -> repository
                         └-> domain service -> infrastructure client/adapter
```

Controllers stay thin (parse + call one service). Services hold business rules
and throw `AppError`. Repositories do data access only. Infra clients
(`*.client.ts`) isolate Redis, storage, email, and the model server.

## Project layout

```
src/
  config/         typed env loader (no direct process.env in feature code)
  common/         errors (AppError + handler), logger, shared constants/types
  routes/         HTTP route definitions
  controller/     thin HTTP adapters
  model/          domain models / Prisma-derived types
  auth/           API-key auth middleware + service
  users/          user repository (quota, rate limit, key hash)
  jobs/           TTS job service, repository, Zod schemas, constants, types
  queue/          BullMQ producer + queue constants
  workers/        BullMQ job processor
  recovery/       Redis disaster-recovery service
  notifications/  email client + notification service
  alerts/         incident alerting + channels (slack/log)
  health/         health & dependency checks
  storage/        S3/MinIO audio client
prisma/           Prisma schema (models added in M2)
docs/             API_CONTRACT.md, ENVIRONMENT.md
```

## Requirements

- Node.js 22 LTS
- PostgreSQL, Redis, an S3-compatible store (MinIO), and an SMTP server
  — all provided by the root `docker-compose.yml`.

## Local setup

```bash
cp .env.example .env        # then adjust values
npm install
npm run prisma:generate
npm run build
```

Run the API and worker (two processes):

```bash
npm run dev          # API (tsx watch)
npm run dev:worker   # Worker (tsx watch)
```

Or use the root `docker-compose.yml` to start the full stack (see repo root).

## Scripts

| Script | Purpose |
|---|---|
| `npm run dev` / `dev:worker` | Watch-mode API / worker |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` / `start:worker` | Run compiled API / worker |
| `npm run typecheck` | Type-check without emit |
| `npm run lint` / `format` | ESLint / Prettier |
| `npm test` | Jest |
| `npm run prisma:generate` / `prisma:migrate` | Prisma client / migrations |

## API examples

```bash
# Submit a job (Bengali text)
curl -sX POST http://localhost:3000/v1/tts/jobs \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"text":"আপনার অডিও তৈরি হচ্ছে।"}'
# -> 202 { "job_id": "...", "status": "queued", "message": "..." }

# Check status
curl -s http://localhost:3000/v1/tts/jobs/$JOB_ID -H "Authorization: Bearer $API_KEY"

# List your jobs
curl -s "http://localhost:3000/v1/tts/jobs?limit=20" -H "Authorization: Bearer $API_KEY"

# Download audio (ownership enforced)
curl -sL http://localhost:3000/v1/tts/jobs/$JOB_ID/audio -H "Authorization: Bearer $API_KEY" -o out.wav

# Health
curl -s http://localhost:3000/health
curl -s http://localhost:3000/health/dependencies
```

## Build, test & verify

```bash
npm ci                 # install deps (also runs `prisma generate` via postinstall)
npm run prisma:generate # (if needed) generate the Prisma client
npm run typecheck      # strict tsc --noEmit
npm run lint           # ESLint (bans `any`, enforces standards)
npm test               # Jest unit tests (mocked infra; no DB/Redis needed)
npm run build          # compile to dist/
# migrations against a running Postgres:
npm run prisma:migrate # dev migration
```

Unit tests live in `tests/unit/` and cover per-user isolation (403/404), input
validation (Bengali/empty/oversized), quota/rate-limit, error-handler mapping,
and the recovery re-enqueue rules.

## Documentation

- Public API: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md)
- Architecture & ops (retry, recovery, alerting, trade-offs): [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Env vars: [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md)
- Full implementation plan: [`plan.md`](plan.md)
- Acceptance / verification plan: [`verification.md`](verification.md)
- Coding standards: [`skills.md`](skills.md)
