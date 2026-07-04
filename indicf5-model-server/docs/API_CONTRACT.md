# indicf5-model-server — Internal API Contract

Authoritative contract for the internal TTS API. This server is **not** public:
only the `tts-api-service` **worker** calls it, over the private network, using
a shared secret. It loads IndicF5 once at startup and returns WAV audio.

- Base URL (dev): `http://model-server:8000` (`MODEL_SERVER_URL` on the caller)
- Auth: every route except `/health` requires header `X-Internal-Token: <secret>`
  where the value equals the server's `INTERNAL_TOKEN`.
- The reference voice + transcript are **server-side** (`REFERENCE_AUDIO_PATH`,
  `REFERENCE_TEXT`). Clients never send them.

---

## `GET /health` — Liveness / readiness

No auth. Used by `tts-api-service` dependency health checks.

`200 OK`:

```json
{ "status": "ok", "model_loaded": true }
```

- `model_loaded` is `false` until the model finishes loading at startup. Callers
  should treat `model_loaded=false` as "not ready" (degraded).

---

## `POST /v1/tts/generate` — Synthesize speech

Headers:

```
X-Internal-Token: <secret>
Content-Type: application/json
```

Request body:

```json
{
  "job_id": "job_123",
  "text": "বাংলা টেক্সট"
}
```

- `job_id`: opaque id from the caller, used only for correlation/logging.
- `text`: Bengali text to synthesize (length-limited by `MAX_TEXT_LENGTH`).

Success — `200 OK`:

- Body: binary WAV audio.
- `Content-Type: audio/wav`
- `Content-Disposition: attachment; filename="<job_id>.wav"`
- Optional header `X-Audio-Duration-Ms: <int>` for the caller to persist.

Errors (JSON body `{ "detail": "<safe message>" }`):

| Status | When |
|---|---|
| `400` | invalid/empty text, or text exceeds `MAX_TEXT_LENGTH` |
| `401` / `403` | missing or invalid `X-Internal-Token` |
| `500` | model inference failure |
| `503` | model not yet loaded / server not ready |

---

## Caller (worker) expectations

The `tts-api-service` worker:

1. Sends `X-Internal-Token`, `job_id`, and Bengali `text`.
2. Uses timeout `MODEL_SERVER_TIMEOUT_MS`; a timeout is treated as a retryable
   failure and maps to job `error_code=model_timeout` (public `504`-class).
3. Retries `5xx`/network/timeout errors with backoff up to
   `MODEL_SERVER_MAX_RETRIES`; after that the job is marked `failed`.
4. Does **not** retry `400` (bad input) — the job fails immediately.
5. On `200`, stores the returned WAV in object storage and records duration.

## Notes to confirm during implementation

IndicF5 (`ai4bharat/IndicF5`) is a voice-cloning TTS. The exact model call
signature (e.g. `AutoModel.from_pretrained(..., trust_remote_code=True)` and the
`(text, ref_audio_path, ref_text)` invocation) and the output sample rate must
be confirmed against the official Hugging Face model card in the model-server
implementation milestone before wiring `services/tts_service.py`.
