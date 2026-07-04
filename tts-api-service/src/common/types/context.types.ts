/**
 * Narrow context objects (skills.md Interface Segregation).
 * Pass these instead of full DB records. Note: apiKeyHash and other secrets are
 * intentionally excluded and must never travel in a context object.
 */
export interface AuthUserContext {
  userId: string;
  email: string;
  rateLimitPerMinute: number;
  monthlyQuota: number;
}
