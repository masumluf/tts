/** Queue names + shared payload type (skills.md DRY). */
export const TTS_GENERATION_QUEUE = 'tts-generation-queue';

/**
 * BullMQ payload. Deliberately minimal: only the job id. The worker reloads the
 * authoritative record from Postgres and never trusts stale queue data.
 */
export interface TtsJobPayload {
  jobId: string;
}
