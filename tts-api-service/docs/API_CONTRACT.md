# tts-api-service — Public API Contract

Client-facing HTTP API. All responses are JSON unless noted. This contract is
frozen in Milestone 1; endpoints are implemented in later milestones.

- Base path: `/v1`
- Auth: every `/v1/tts/*` endpoint requires `Authorization: Bearer <api_key>`.
- Content type: `application/json` for request bodies.
- The API is a thin edge: it validates, persists to Postgres, enqueues to
  BullMQ, and returns immediately. It **never** runs TTS inference itself.

---

## Authentication

```
Authorization: Bearer <api_key>
```

- API keys are hashed (with a server-side pepper) before storage; raw keys are
  never stored or returned.
- Every job belongs to exactly one user. A user can only read/download their
  own jobs.

| Condition | Status |
|---|---|
| Missing `Authorization` header | `401` |
| Malformed / invalid API key | `401` |
| Valid key | request proceeds |
| Accessing another user's job | `403` |

---

## `POST /v1/tts/jobs` — Create a TTS job

Creates a job (`status=queued`) in Postgres, enqueues `job_id` to BullMQ, and
returns immediately.

Request body:

```json
{ "text": "আপনার অডিও তৈরি হচ্ছে।" }
```

Validation order (plan.md Phase 4): API key → Bengali text → text length →
quota → rate limit.

Success — `202 Accepted`:

```json
{
  "job_id": "job_123",
  "status": "queued",
  "message": "Your audio generation request has been accepted. You will receive an email when it is ready."
}
```

Errors:

| Status | When |
|---|---|
| `400` | empty text / invalid payload / not valid Bengali text |
| `401` | missing/invalid API key |
| `413` | text exceeds `MAX_TEXT_LENGTH` |
| `429` | per-user rate limit exceeded, or too many pending jobs |
| `503` | global queue full / service busy |
| `500` | internal error |

---

## `GET /v1/tts/jobs` — List the authenticated user's jobs

Returns only the caller's jobs (newest first, paginated).

Query params: `?limit=20&cursor=<opaque>` (defaults applied server-side).

`200 OK`:

```json
{
  "items": [
    {
      "job_id": "job_123",
      "status": "completed",
      "created_at": "2026-07-03T10:00:00Z",
      "completed_at": "2026-07-03T10:00:12Z"
    }
  ],
  "next_cursor": null
}
```

---

## `GET /v1/tts/jobs/:jobId` — Job status

`200 OK` — status mirrors Postgres (source of truth). Possible `status` values:
`queued | processing | retrying | completed | failed | timeout`.

Completed:

```json
{
  "job_id": "job_123",
  "status": "completed",
  "audio_url": "https://.../job_123.wav?X-Amz-...",
  "duration_ms": 4200,
  "created_at": "2026-07-03T10:00:00Z",
  "completed_at": "2026-07-03T10:00:12Z"
}
```

Failed (safe message only — no internal/model detail):

```json
{
  "job_id": "job_123",
  "status": "failed",
  "error_code": "model_error",
  "error_message": "Audio generation failed. Please try submitting your request again.",
  "failed_at": "2026-07-03T10:01:00Z"
}
```

| Status | When |
|---|---|
| `200` | own job found |
| `403` | job belongs to another user |
| `404` | job not found |

---

## `GET /v1/tts/jobs/:jobId/audio` — Download audio

Ownership is checked before serving. Returns the WAV (either a `302` redirect to
a presigned storage URL or a streamed `audio/wav` body — implementation decided
in M5/M7).

| Status | When |
|---|---|
| `200` / `302` | own completed job with audio |
| `403` | job belongs to another user |
| `404` | job not found, or job has no audio yet |

---

## `GET /health` — Liveness

`200 OK`:

```json
{ "status": "healthy" }
```

## `GET /health/dependencies` — Dependency health

`200` when healthy, `503` when degraded. Body (plan.md Phase 12):

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

When a critical dependency is unavailable, the service refuses new jobs
(`503`) and an incident alert is raised (verification.md §10).

---

## Error envelope

All non-2xx responses share one shape, produced by the centralized error
handler (skills.md: services throw `AppError`, handler formats JSON):

```json
{
  "error": {
    "code": "rate_limited",
    "message": "Too many requests. Please slow down and try again shortly."
  }
}
```

`code` values map to HTTP status per plan.md Phase 13:
`bad_request(400)`, `unauthorized(401)`, `forbidden(403)`, `not_found(404)`,
`payload_too_large(413)`, `rate_limited(429)`, `service_unavailable(503)`,
`internal(500)`, `gateway_timeout(504)`.
