# Bengali TTS Platform (IndicF5)

A production-minded backend that wraps the GPU-bound **IndicF5** text-to-speech
model behind an asynchronous, multi-user API. You submit Bengali text, the
service queues the work, a worker runs inference on a separate model server, and
you download a playable WAV.

The interesting part isn't the model call — it's keeping the service responsive
under concurrent, multi-user load. That design is summarized below and explained
in depth in **[docs/DECISIONS.md](docs/DECISIONS.md)**.

## How this maps to the brief

| Requirement | Where it lives |
|---|---|
| Wrap IndicF5; Bengali text → playable audio | `POST /v1/tts/jobs` → `GET /v1/tts/jobs/:id/audio` (WAV); model in `indicf5-model-server` |
| Auth / API keys | `src/auth/*` — hashed API keys, `Authorization: Bearer` |
| Per-user isolation | `src/jobs/*` — every read/download scoped + ownership-checked (403/404) |
| Concurrency: queue + worker (submit → poll) | `src/queue/*`, `src/workers/*` — BullMQ; API returns `202` immediately |
| Backpressure / timeouts / rate limiting | per-user rate limit + pending cap (`429`), global queue cap (`503`), job & model timeouts (`504`) |
| Robustness (oversized/invalid/model-fail/long jobs) | Zod validation, centralized error handler, retries→`failed`, stale-job recovery |
| Explain trade-offs | [docs/DECISIONS.md](docs/DECISIONS.md), [tts-api-service/docs/ARCHITECTURE.md](tts-api-service/docs/ARCHITECTURE.md) |

## Architecture

Two services, deliberately separate so the heavy Python/GPU runtime scales
independently of the lightweight API/worker:

| Service | Stack | Responsibility |
|---|---|---|
| [`tts-api-service`](tts-api-service) | TypeScript (Node 22 LTS) | Public API, auth, per-user isolation, Postgres (source of truth), BullMQ queue, worker |
| [`indicf5-model-server`](indicf5-model-server) | Python / FastAPI | Loads IndicF5 once, synthesizes WAV, internal-only (`X-Internal-Token`) |

```
Client ──(Bearer key, Bengali text)──> API ──> Postgres (source of truth)
                                         │
                                         └──> Redis/BullMQ ──> Worker ──HTTP──> model-server (IndicF5)
                                                                 │
                                                                 ├──> object storage (WAV, MinIO/S3)
                                                                 └──> status → completed/failed
Client <──(WAV)── API  GET /v1/tts/jobs/:id/audio  (ownership-checked)
```

**The API never loads the model** — it only enqueues and reads results, so it
stays responsive no matter how slow inference is.

## End-to-end flow

```
1. POST /v1/tts/jobs {text}   → validate key, Bengali text, size, quota, rate limit
2. create job in Postgres (queued) → enqueue job_id to BullMQ → return 202 {job_id}
3. worker: queued → processing → call model-server → store WAV → completed
4. GET /v1/tts/jobs/:id        → poll status
5. GET /v1/tts/jobs/:id/audio  → download WAV (ownership enforced)
```

Durability rule: **Postgres is authoritative; Redis is only the execution
queue.** If Redis loses jobs, the recovery service re-enqueues unfinished ones.

## Quickstart (one command)

**Prerequisites:** Docker + Docker Compose. A Hugging Face account with access to
the gated [`ai4bharat/IndicF5`](https://huggingface.co/ai4bharat/IndicF5) model,
and a reference voice clip. (Everything else — Postgres, Redis, object storage,
SMTP — runs as containers.)

```bash
cd ass-sunnah
cp .env.example .env
```

Edit `.env` and set at least:

```bash
API_KEY_PEPPER=<any-random-secret>
MODEL_SERVER_INTERNAL_TOKEN=<any-random-secret>
HF_TOKEN=<your-huggingface-read-token>        # IndicF5 is a gated model
REFERENCE_TEXT=<exact transcript of your reference clip>
```

Add a reference voice (IndicF5 clones a voice; any supported-language clip works,
output language follows the request text):

```bash
# either your own 5–10s mono WAV, or an official sample:
curl -L "https://github.com/AI4Bharat/IndicF5/raw/refs/heads/main/prompts/MAR_F_WIKI_00001.wav" \
  -o indicf5-model-server/reference/voice.wav
# and set REFERENCE_TEXT in .env to that clip's transcript.
```

Bring up the whole stack (Postgres, Redis, MinIO, MailHog, model server, API,
worker) and create a user:

```bash
docker compose up -d --build          # migrate runs automatically; model weights download on first boot
docker compose run --rm migrate npx tsx prisma/seed.ts   # prints an API key — copy it
```

### Try it

```bash
export BASE=http://localhost:3000
export API_KEY=ttsk_...               # from the seed output

# submit
curl -s -X POST $BASE/v1/tts/jobs \
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \
  -d '{"text":"আপনার অডিও তৈরি হয়ে গেছে।"}'
# -> 202 {"job_id":"...","status":"queued", ...}

# poll
curl -s $BASE/v1/tts/jobs/<job_id> -H "Authorization: Bearer $API_KEY"

# download when status = completed
curl -sL $BASE/v1/tts/jobs/<job_id>/audio -H "Authorization: Bearer $API_KEY" -o out.wav
```

Ports: API `:3000`, model server `:8000`, MinIO console `:9001`, MailHog UI `:8025`.

> First model-server boot downloads multi-GB IndicF5 weights and, on CPU, is
> slow — this is a demo constraint, not a design limit. See the GPU/scaling notes
> in [docs/DECISIONS.md](docs/DECISIONS.md).

## Robustness — status codes

| Code | When |
|---|---|
| `202` | job accepted (queued) |
| `400` | empty / non-Bengali / invalid payload |
| `401` | missing / invalid API key |
| `403` | accessing another user's job |
| `404` | job not found / no audio yet |
| `413` | text exceeds `MAX_TEXT_LENGTH` |
| `429` | rate limit / too many pending jobs |
| `503` | global queue full |
| `504` | model timeout |

## Scaling under load

The design separates "stay responsive" from "go faster":

- **API stays responsive by construction** — it never runs inference, only
  enqueues and reads, so its latency is independent of model speed and load.
- **Add workers to drain the queue faster.** Workers are stateless and share the
  BullMQ queue, so you can scale them out of the box:

  ```bash
  docker compose up -d --scale worker=3
  ```

- **The model server is the real throughput unit.** Inference is serialized per
  model process, so to raise capacity you run more model-server replicas; the
  workers reach them via the `model-server` service name and Docker DNS
  round-robins across replicas:

  ```bash
  # remove the host `ports:` mapping on model-server first (replicas can't share
  # host port 8000 — it's published only for local debugging), then:
  docker compose up -d --scale model-server=2 --scale worker=4
  ```

- **GPU in production.** The local image is CPU-only (Apple Silicon). On a GPU
  host, build the model image against a CUDA base + CUDA torch wheels and set
  `MODEL_DEVICE=cuda`; the model is loaded once and kept warm. Autoscaling
  model-server replicas on BullMQ queue depth (KEDA/HPA) is the natural next
  step. See [docs/DECISIONS.md](docs/DECISIONS.md) §4.

Backpressure keeps this safe: per-user rate limit + pending cap (`429`) and a
global queue cap (`503`) shed load before the backlog grows unbounded.

## Testing

```bash
cd tts-api-service
npm ci && npm run typecheck && npm test
```

Unit tests cover per-user isolation, input validation, quota/rate-limit, error
mapping, and the recovery re-enqueue rules.

## Configuration & contracts

- Env reference: [tts-api-service/docs/ENVIRONMENT.md](tts-api-service/docs/ENVIRONMENT.md)
- Public API contract: [tts-api-service/docs/API_CONTRACT.md](tts-api-service/docs/API_CONTRACT.md)
- Internal model API contract: [indicf5-model-server/docs/API_CONTRACT.md](indicf5-model-server/docs/API_CONTRACT.md)
- **Design & trade-offs: [docs/DECISIONS.md](docs/DECISIONS.md)**
- Architecture & ops: [tts-api-service/docs/ARCHITECTURE.md](tts-api-service/docs/ARCHITECTURE.md)

## Beyond the brief (production hardening)

These aren't required by the task but are included to show production thinking;
they're optional and clearly isolated: **email notifications** on completion/
failure, **incident alerting** (dependency failures / abnormal failure rates),
and **Redis disaster recovery** (re-enqueue lost/stale jobs from Postgres).

## Infra assumptions

- Local dev runs entirely in Docker (managed Postgres/Redis are supported too —
  set `DATABASE_URL`/`REDIS_URL`). Redis must allow blocking commands and use
  `maxmemory-policy noeviction` (set here) for BullMQ.
- Object storage is S3-compatible (MinIO locally; swap `S3_*` for real S3).
- The model server is intended to run on GPU in production (`MODEL_DEVICE=cuda`)
  and scale horizontally; local runs default to CPU.
