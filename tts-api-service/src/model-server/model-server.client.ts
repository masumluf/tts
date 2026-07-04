/**
 * HTTP client for the internal IndicF5 model server.
 * Infra-only (skills.md): RouterOS-equivalent boundary — it just talks HTTP and
 * normalizes responses. No job classification or storage decisions here.
 * See indicf5-model-server/docs/API_CONTRACT.md.
 */
import axios, { AxiosError, type AxiosInstance } from 'axios';
import { env } from '../config/env';

export interface GenerateAudioResult {
  /** Raw WAV bytes returned by the model server. */
  audio: Buffer;
  /** Reported audio duration in ms, when the server provides it. */
  durationMs: number | undefined;
}

/** Categorized failure so the worker can decide retry vs. fail (no `any`). */
export type ModelServerErrorKind =
  | 'timeout'
  | 'bad_request'
  | 'unauthorized'
  | 'server_error'
  | 'network';

export class ModelServerError extends Error {
  constructor(
    public readonly kind: ModelServerErrorKind,
    message: string,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'ModelServerError';
  }
}

const client: AxiosInstance = axios.create({
  baseURL: env.MODEL_SERVER_URL,
  timeout: env.MODEL_SERVER_TIMEOUT_MS,
  headers: { 'X-Internal-Token': env.MODEL_SERVER_INTERNAL_TOKEN },
});

function toModelServerError(error: unknown): ModelServerError {
  if (error instanceof AxiosError) {
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
      return new ModelServerError('timeout', 'Model server request timed out.');
    }
    const status = error.response?.status;
    if (status === undefined) {
      return new ModelServerError('network', 'Model server is unreachable.');
    }
    if (status === 400) {
      return new ModelServerError('bad_request', 'Model server rejected the input.', status);
    }
    if (status === 401 || status === 403) {
      return new ModelServerError('unauthorized', 'Model server rejected the internal token.', status);
    }
    return new ModelServerError('server_error', `Model server error (${status}).`, status);
  }
  return new ModelServerError('network', 'Unexpected model server client error.');
}

export const modelServerClient = {
  async generate(jobId: string, text: string): Promise<GenerateAudioResult> {
    try {
      const response = await client.post(
        '/v1/tts/generate',
        { job_id: jobId, text },
        { responseType: 'arraybuffer' },
      );
      const durationHeader = response.headers['x-audio-duration-ms'];
      const durationMs =
        typeof durationHeader === 'string' && durationHeader.length > 0
          ? Number.parseInt(durationHeader, 10)
          : undefined;
      return {
        audio: Buffer.from(response.data as ArrayBuffer),
        durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
      };
    } catch (error) {
      throw toModelServerError(error);
    }
  },

  /** Health probe: true only when the server reports the model is loaded. */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await client.get('/health', { timeout: 5000 });
      const data = response.data as { status?: string; model_loaded?: boolean };
      return data?.status === 'ok' && data?.model_loaded === true;
    } catch {
      return false;
    }
  },
};

export type ModelServerClient = typeof modelServerClient;
