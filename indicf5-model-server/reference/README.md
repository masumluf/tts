# Server-side reference voice

Place the reference voice audio (e.g. `voice.wav`) and its transcript here. The
model server uses these server-side inputs for IndicF5 voice cloning; clients
never provide them. Configure paths via `REFERENCE_AUDIO_PATH` and
`REFERENCE_TEXT` (see `.env.example`). Do not commit real voice assets unless
licensed for the repo.
