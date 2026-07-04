/**
 * Per-user fixed-window rate limiter backed by Redis. The limit is dynamic
 * (from users.rate_limit_per_minute), so we can't use a static express limiter.
 * Isolation: keyed by userId, so one abusive user cannot affect others.
 */
import { redis } from '../../config/redis';

const WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
}

export async function checkUserRateLimit(
  userId: string,
  limitPerMinute: number,
): Promise<RateLimitResult> {
  const bucket = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${userId}:${bucket}`;
  const count = await redis.incr(key);
  if (count === 1) {
    // First hit in this window — expire slightly after the window closes.
    await redis.expire(key, WINDOW_SECONDS + 5);
  }
  return { allowed: count <= limitPerMinute, remaining: Math.max(0, limitPerMinute - count) };
}
