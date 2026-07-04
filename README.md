# Bengali TTS Platform

An asynchronous Bengali text-to-speech platform split into **two repositories**:

| Repo | Stack | Responsibility |
|---|---|---|
| [`tts-api-service`](tts-api-service) | TypeScript (Node 22 LTS) | Public API, auth, per-user isolation, Postgres source-of-truth, BullMQ queue, worker, Redis recovery, email, alerts, health checks |
| [`indicf5-model-server`](indicf5-model-server) | Python / FastAPI | Dockerized IndicF5 model; loads once; returns WAV audio; internal-only |

The API service **never loads the AI model** — it calls the model server over
HTTP. Keeping the model in its own repo/image lets the heavy Python+GPU runtime
scale and deploy independently of the lightweight API/worker.

## End-to-end flow

```
1. Client  POST /v1/tts/jobs  (Bearer API key, Bengali text)
2. API     validate key, quota, rate limit, size, Bengali text
3. API     create job in Postgres (status=queued)
4. API     push job_id to BullMQ (Redis)
5. API     return job_id immediately (202)
6. Worker  pick job -> status=processing
7. Worker  call model-server POST /v1/tts/generate (X-Internal-Token)
8. Worker  store WAV in object storage
9. Worker  status=completed -> send success email -> write job_events
10. Client GET /v1/tts/jobs/:jobId/audio  (ownership checked)
```

Durability: **Postgres is the source of truth; Redis is only the execution
queue.** If Redis loses jobs, the recovery service scans Postgres and re-enqueues
queued/stale/retrying jobs.

## Contracts

- Public API: [`tts-api-service/docs/API_CONTRACT.md`](tts-api-service/docs/API_CONTRACT.md)
- Internal model API: [`indicf5-model-server/docs/API_CONTRACT.md`](indicf5-model-server/docs/API_CONTRACT.md)

The shared secret `MODEL_SERVER_INTERNAL_TOKEN` (API) must equal `INTERNAL_TOKEN`
(model server).

## Run the full stack (local)

```bash
cp .env.example .env            # set MODEL_SERVER_INTERNAL_TOKEN + API_KEY_PEPPER
docker compose up --build
```

Services and ports:

| Service | URL / Port |
|---|---|
| API | http://localhost:3000 |
| Model server | http://localhost:8000 |
| Postgres | localhost:5432 |
| Redis | localhost:6379 |
| MinIO API / console | http://localhost:9000 / http://localhost:9001 |
| MailHog UI | http://localhost:8025 |

Smoke checks (available once the corresponding milestones land):

```bash
curl http://localhost:3000/health
curl http://localhost:3000/health/dependencies
curl http://localhost:8000/health
```

## Repository layout

```
.
├── docker-compose.yml        # full-stack orchestration (both repos + infra)
├── .env.example              # root compose env
├── tts-api-service/          # TypeScript API + worker
└── indicf5-model-server/     # Python/FastAPI IndicF5 server
```

## Build order (milestones)

1. **M1 (done):** repo structure, API contracts, env vars, Docker Compose design.
2. Database schema (Postgres-native, Prisma).
3. Auth + per-user isolation.
4. Job submission API.
5. Job status + audio APIs.
6. BullMQ queue.
7. Worker + model-server integration + storage.
8. Model server implementation (IndicF5).
9. Redis disaster recovery.
10. Incident alerting.
11. Email notifications.
12. Health checks.
13. Error handling.
14. Documentation + tests.

Each milestone is delivered independently with run/test instructions and a
requirements checklist. Standards followed throughout: `tts-api-service/skills.md`.
