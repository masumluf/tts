# indicf5-model-server

Dockerized Python/FastAPI server that wraps the **IndicF5** TTS model. It loads
the model **once at startup**, uses a **server-side reference voice + transcript**
for voice cloning, and exposes an internal-only API that returns playable WAV
audio.

> This is a private service. Only the `tts-api-service` worker calls it, over the
> internal network, authenticated with a shared `X-Internal-Token`. It is never
> exposed to public clients.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/health` | none | Liveness + `model_loaded` status |
| `POST` | `/v1/tts/generate` | `X-Internal-Token` | Synthesize Bengali text → WAV |

Full details: [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Project layout

```
app/
  main.py              FastAPI app factory + startup model load (lifespan)
  api/
    dependencies.py    X-Internal-Token auth dependency
    routes/health.py   GET /health
    routes/tts.py      POST /v1/tts/generate
  core/
    config.py          typed settings (pydantic-settings)
    logging.py         structured logging
  services/
    model_loader.py    loads IndicF5 once; holds the singleton
    tts_service.py     text -> WAV bytes using server-side reference voice
  schemas/tts.py       request/response models
reference/             server-side reference voice.wav + transcript
docs/API_CONTRACT.md   internal contract
```

## Requirements

- Python 3.11
- The IndicF5 model weights (downloaded from Hugging Face on first run; cached
  under `HF_HOME`).
- A reference voice WAV + its transcript placed in `reference/` (see
  `reference/README.md`).

## Local setup

```bash
cp .env.example .env         # set INTERNAL_TOKEN, reference paths, etc.
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Or build the image and run via the root `docker-compose.yml`.

```bash
docker build -t indicf5-model-server .
```

## Configuration

See [`.env.example`](.env.example). Key variables:

- `INTERNAL_TOKEN` — must equal `MODEL_SERVER_INTERNAL_TOKEN` in `tts-api-service`.
- `MODEL_ID` (`ai4bharat/IndicF5`), `MODEL_DEVICE` (`cpu`/`cuda`), `HF_HOME`.
- `REFERENCE_AUDIO_PATH`, `REFERENCE_TEXT` — server-side voice cloning inputs.
- `MAX_TEXT_LENGTH`, `REQUEST_TIMEOUT_SECONDS`.

## Milestone status

- **M1 (done):** repo structure, internal API contract, env var list, Dockerfile,
  Docker Compose wiring.
- Later: implement settings, model loading, synthesis, auth dependency, routes,
  and tests. The exact IndicF5 inference call is confirmed against the official
  model card before implementation.
