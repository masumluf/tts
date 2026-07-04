/**
 * Redis connections (ioredis) for BullMQ + rate limiting.
 * skills.md Dependency Inversion: infra created here, injected elsewhere.
 * Redis is ONLY the execution queue; Postgres remains the source of truth.
 */
import { Redis } from 'ioredis';
import { env } from './env';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on connections that issue
 * blocking commands (workers). We use the same setting everywhere for safety.
 */
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}

/** Shared connection for the rate limiter and health checks. */
export const redis: Redis = createRedisConnection();

/**
 * Connection options for BullMQ. We pass options (not a shared ioredis
 * instance) so BullMQ builds its own connection with its own bundled ioredis;
 * this avoids the structural type clash between two ioredis copies. BullMQ's
 * RedisOptions accepts a `url`, and workers require `maxRetriesPerRequest: null`.
 */
export const bullConnectionOptions: { url: string; maxRetriesPerRequest: null } = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null,
};

export async function pingRedis(): Promise<void> {
  const result = await redis.ping();
  if (result !== 'PONG') {
    throw new Error(`Unexpected Redis ping response: ${result}`);
  }
}
