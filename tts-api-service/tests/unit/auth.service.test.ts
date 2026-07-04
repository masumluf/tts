import type { User } from '@prisma/client';

jest.mock('../../src/users/user.repository', () => ({
  userRepository: { findByApiKeyHash: jest.fn(), findById: jest.fn() },
}));

import { hashApiKey, resolveApiKey, generateApiKey } from '../../src/auth/auth.service';
import { userRepository } from '../../src/users/user.repository';

const mockRepo = userRepository as jest.Mocked<typeof userRepository>;

function fakeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Test',
    email: 'test@example.com',
    apiKeyHash: hashApiKey('secret-key'),
    rateLimitPerMinute: 60,
    monthlyQuota: 1000,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('auth.service', () => {
  it('hashes deterministically and never returns the raw key', () => {
    expect(hashApiKey('abc')).toEqual(hashApiKey('abc'));
    expect(hashApiKey('abc')).not.toEqual('abc');
    expect(generateApiKey()).toMatch(/^ttsk_/);
  });

  it('resolves a valid key to a narrow context (no apiKeyHash leaked)', async () => {
    mockRepo.findByApiKeyHash.mockResolvedValue(fakeUser());
    const ctx = await resolveApiKey('secret-key');
    expect(ctx).toEqual({
      userId: 'user-1',
      email: 'test@example.com',
      rateLimitPerMinute: 60,
      monthlyQuota: 1000,
    });
    expect(ctx as unknown as Record<string, unknown>).not.toHaveProperty('apiKeyHash');
  });

  it('returns null for an unknown key', async () => {
    mockRepo.findByApiKeyHash.mockResolvedValue(null);
    expect(await resolveApiKey('nope')).toBeNull();
  });
});
