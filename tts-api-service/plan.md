# 1. Backend Implementation Plan

## Architecture

Build two separate repositories:

```text
tts-api-service
- TypeScript backend
- Public API
- Auth/API key
- User isolation
- Postgres job tracking
- Redis/BullMQ queue
- Worker service
- Recovery service
- Email notification
- Incident alerting

indicf5-model-server
- Python/FastAPI
- Dockerized IndicF5 model
- Loads model once
- Exposes internal TTS API
- Returns WAV audio
```

## Phase 1 — Project Setup

Create `tts-api-service`.

Required modules:

```text
src/
  controller/
  routes/
  model/
  config/
  auth/
  users/
  jobs/
  queue/
  workers/
  recovery/
  notifications/
  alerts/
  health/
  storage/
  common/
```

Add dependencies:

```text
PostgreSQL
Redis
BullMQ
Prisma/TypeORM
Zod/Joi/class-validator
Nodemailer/SendGrid
Winston/Pino logger
Axios
```

Add Docker Compose for:

```text
api
worker
postgres
redis
```

## Phase 2 — Database Design

Create tables:

```text
users
- id
- name
- email
- api_key_hash
- rate_limit_per_minute
- monthly_quota
- created_at

tts_jobs
- id
- user_id
- text
- status
- retry_count
- max_retry
- error_code
- error_message
- audio_url
- audio_path
- duration_ms
- created_at
- queued_at
- started_at
- completed_at
- failed_at

job_events
- id
- job_id
- event_type
- message
- metadata
- created_at

incident_alerts
- id
- service_name
- severity
- message
- status
- created_at
```

Postgres should be the durable source of truth. Redis should only be the execution queue.

## Phase 3 — Authentication and User Isolation

Implement API key authentication:

```http
Authorization: Bearer <api_key>
```

Rules:

```text
- Hash API keys before storing.
- Every job must belong to one user.
- User can only read/download their own jobs.
- Internal model server should require X-Internal-Token.
```

## Phase 4 — Job Submission API

Endpoint:

```http
POST /v1/tts/jobs
```

Request:

```json
{
  "text": "আপনার অডিও তৈরি হচ্ছে।"
}
```

Flow:

```text
1. Validate API key.
2. Validate Bengali text.
3. Check text length.
4. Check user quota.
5. Check rate limit.
6. Create Postgres job with status = queued.
7. Push job_id to BullMQ.
8. Return immediate response.
```

Response:

```json
{
  "job_id": "job_123",
  "status": "queued",
  "message": "Your audio generation request has been accepted. You will receive an email when it is ready."
}
```

## Phase 5 — Job Status and Audio APIs

Endpoints:

```http
GET /v1/tts/jobs
GET /v1/tts/jobs/:jobId
GET /v1/tts/jobs/:jobId/audio
```

Rules:

```text
- User can only access own jobs.
- Completed jobs return audio URL.
- Failed jobs return failure reason.
- Audio download should check ownership before serving file.
```

## Phase 6 — BullMQ Queue

Create queue:

```text
tts-generation-queue
```

Configure:

```text
max attempts: 3
backoff: exponential/fixed
timeout: 120 seconds
concurrency: 1 or 2
removeOnComplete: false initially
removeOnFail: false initially
```

Important:

```text
- Do not run model inside API request.
- Worker should process jobs.
- API should stay responsive.
```

## Phase 7 — Worker Service

Worker flow:

```text
1. Pick job_id from Redis.
2. Load job from Postgres.
3. If job is already completed, skip.
4. Update Postgres status = processing.
5. Call model server using MODEL_SERVER_URL.
6. Receive WAV audio.
7. Store audio in local storage/S3/MinIO.
8. Update Postgres status = completed.
9. Send success email.
10. Write job_events.
```

Failure flow:

```text
1. Capture error.
2. Increase retry_count.
3. If retry_count < max_retry, mark retrying and requeue.
4. If max retry reached, mark failed.
5. Send failure email.
6. Trigger incident alert if needed.
```

## Phase 8 — Model Server Integration

`indicf5-model-server` should expose:

```http
GET /health
POST /v1/tts/generate
```

Request:

```json
{
  "job_id": "job_123",
  "text": "বাংলা টেক্সট"
}
```

Headers:

```http
X-Internal-Token: <secret>
```

Response should be binary WAV or downloadable file response.

Recommended:

```text
- Model server returns binary WAV.
- Worker stores the audio.
- Public API never exposes model server directly.
```

## Phase 9 — Redis Disaster Recovery

Recovery service runs:

```text
- On API/worker startup
- Periodically every few minutes
```

Recovery rules:

```text
Postgres queued + missing from Redis
→ re-enqueue

Postgres processing + stale timestamp
→ re-enqueue

Postgres retrying
→ re-enqueue

Postgres completed
→ do nothing

Postgres failed + retry_count < max_retry
→ re-enqueue

Postgres failed + retry_count >= max_retry
→ do nothing
```

## Phase 10 — Incident Alerting

Monitor:

```text
- Redis
- Postgres
- Model server
- Email service
- Audio storage
- Queue backlog
- Stuck jobs
- High failure rate
```

Trigger alerts when:

```text
- Redis unavailable
- Postgres unavailable
- Model server health check fails
- Email provider fails
- Queue size exceeds threshold
- Too many jobs fail within a time window
- Jobs stay processing too long
```

Alert channels:

```text
- Slack webhook
- Email
- Sentry/Datadog log event
```

## Phase 11 — Email Notification

Send email when:

```text
- Job completed successfully
- Job failed after all retries
```

Success email should include:

```text
- Job ID
- Completion status
- Audio download link
```

Failure email should include:

```text
- Job ID
- Failure status
- Simple retry instruction
```

## Phase 12 — Health Checks

Endpoints:

```http
GET /health
GET /health/dependencies
```

Check:

```text
- API process
- Postgres ping
- Redis ping
- Model server /health
- Email provider
- Storage read/write
```

Example degraded response:

```json
{
  "status": "degraded",
  "dependencies": {
    "postgres": "ok",
    "redis": "ok",
    "model_server": "down",
    "email": "ok",
    "storage": "ok"
  }
}
```

## Phase 13 — Error Handling

Handle:

```text
400 invalid input
401 missing/invalid API key
403 accessing another user’s job
404 job not found
413 text too large
429 rate limit exceeded
429 too many pending jobs
503 queue full/service busy
500 internal error
504 model timeout
```

## Phase 14 — Documentation

README should include:

```text
- Architecture overview
- Local setup
- Environment variables
- Docker Compose instructions
- API examples
- Queue/worker explanation
- Retry strategy
- Redis recovery strategy
- Incident alert strategy
- Production trade-offs
- Why model server is separate repo
```
