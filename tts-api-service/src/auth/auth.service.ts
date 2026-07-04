/**
 * Auth domain service.
 * skills.md: API keys are hashed before storage; raw keys are never stored,
 * logged, or returned. Hash = SHA-256 over (apiKey + server pepper).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';
import type { AuthUserContext } from '../common/types/context.types';
import { userRepository } from '../users/user.repository';

const API_KEY_PREFIX = 'ttsk_';

/** Deterministic keyed hash used for lookup + storage. */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(`${apiKey}${env.API_KEY_PEPPER}`).digest('hex');
}

/** Generate a new opaque API key (used for seeding/admin, not request paths). */
export function generateApiKey(): string {
  return `${API_KEY_PREFIX}${randomBytes(24).toString('hex')}`;
}

/** Constant-time comparison to avoid leaking timing information. */
function safeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Resolve an API key to a user context, or null if invalid.
 * Returns a narrow context (skills.md) — never the full user record.
 */
export async function resolveApiKey(apiKey: string): Promise<AuthUserContext | null> {
  const hash = hashApiKey(apiKey);
  const user = await userRepository.findByApiKeyHash(hash);
  if (!user) {
    return null;
  }
  // Defensive re-check (repository already filters by hash).
  if (!safeEqualHex(user.apiKeyHash, hash)) {
    return null;
  }
  return {
    userId: user.id,
    email: user.email,
    rateLimitPerMinute: user.rateLimitPerMinute ?? 60,
    monthlyQuota: user.monthlyQuota ?? 1000,
  };
}
