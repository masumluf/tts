/**
 * Structured logger (pino). Single source of truth for logging.
 * skills.md: NEVER log secrets/tokens/keys. Redaction paths below strip common
 * sensitive fields from request logs and error metadata.
 */
import pino, { type Logger } from 'pino';
import { env } from '../../config/env';

/**
 * Pretty logs are nice in local dev, but `pino-pretty` is a devDependency and
 * is absent from the production Docker image (built with --omit=dev). Only
 * enable the transport when it's actually resolvable, so a missing module can
 * never crash the process (it falls back to structured JSON logs).
 */
function prettyTransport(): { target: string; options: { colorize: boolean } } | undefined {
  if (env.NODE_ENV !== 'development') {
    return undefined;
  }
  try {
    require.resolve('pino-pretty');
    return { target: 'pino-pretty', options: { colorize: true } };
  } catch {
    return undefined;
  }
}

const transport = prettyTransport();

export const logger: Logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-internal-token"]',
      'apiKey',
      'apiKeyHash',
      'password',
      'token',
      'smtpPass',
      '*.password',
      '*.token',
    ],
    censor: '[redacted]',
  },
  ...(transport ? { transport } : {}),
});

/** Child logger bound to a correlation id (skills.md observability). */
export function withCorrelation(correlationId: string): Logger {
  return logger.child({ correlationId });
}
