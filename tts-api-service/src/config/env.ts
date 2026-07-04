/**
 * Typed environment configuration.
 *
 * skills.md: feature code MUST import `env` from here and never touch
 * `process.env` directly. All variables are validated once at startup; the
 * process fails fast (exit 1) on misconfiguration. Secrets are never logged.
 */
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

/** Treat empty strings as "unset" so blank .env lines become `undefined`. */
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);

const boolFromString = z.enum(['true', 'false']).transform((value) => value === 'true');

const envSchema = z.object({
  // runtime
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),

  // postgres — source of truth
  DATABASE_URL: z.string().min(1),

  // redis — execution queue only
  REDIS_URL: z.string().min(1),

  // bullmq
  TTS_QUEUE_NAME: z.string().min(1).default('tts-generation-queue'),
  QUEUE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  QUEUE_BACKOFF_TYPE: z.enum(['exponential', 'fixed']).default('exponential'),
  QUEUE_BACKOFF_DELAY_MS: z.coerce.number().int().nonnegative().default(5000),
  QUEUE_JOB_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(1),

  // model server
  MODEL_SERVER_URL: z.string().url(),
  MODEL_SERVER_INTERNAL_TOKEN: z.string().min(1),
  MODEL_SERVER_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  MODEL_SERVER_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),

  // storage (minio / s3)
  S3_ENDPOINT: z.string().url(),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: boolFromString.default('true'),
  AUDIO_URL_EXPIRY_SECONDS: z.coerce.number().int().positive().default(3600),

  // email (smtp)
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: boolFromString.default('false'),
  SMTP_USER: optionalString,
  SMTP_PASS: optionalString,
  EMAIL_FROM: z.string().min(1).default('TTS Service <no-reply@tts.local>'),

  // limits & backpressure
  MAX_TEXT_LENGTH: z.coerce.number().int().positive().default(5000),
  MAX_PENDING_JOBS_PER_USER: z.coerce.number().int().positive().default(20),
  GLOBAL_QUEUE_MAX: z.coerce.number().int().positive().default(1000),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),

  // security
  API_KEY_PEPPER: z.string().min(1),

  // recovery
  RECOVERY_ENABLED: boolFromString.default('true'),
  RECOVERY_INTERVAL_MS: z.coerce.number().int().positive().default(120000),
  STALE_PROCESSING_TIMEOUT_MS: z.coerce.number().int().positive().default(180000),

  // alerting
  ALERT_SLACK_WEBHOOK_URL: optionalUrl,
  ALERT_EMAIL_TO: optionalString,
  SENTRY_DSN: optionalString,
  FAILURE_RATE_WINDOW_MS: z.coerce.number().int().positive().default(300000),
  FAILURE_RATE_THRESHOLD: z.coerce.number().int().positive().default(10),
  QUEUE_BACKLOG_THRESHOLD: z.coerce.number().int().positive().default(500),
  STUCK_JOB_THRESHOLD_MS: z.coerce.number().int().positive().default(300000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    // Startup happens before the logger is configured; use console + exit.
    // Print only field names/messages, never values (no secrets leaked).
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    // eslint-disable-next-line no-console
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return Object.freeze(parsed.data);
}

export const env: Env = loadEnv();
