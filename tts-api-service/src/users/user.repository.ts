/**
 * Data access for `users`. Repositories do data access only (skills.md):
 * no HTTP, no business rules, no notifications.
 */
import type { User } from '@prisma/client';
import { prisma } from '../config/prisma';

export const userRepository = {
  findByApiKeyHash(apiKeyHash: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { apiKeyHash } });
  },

  findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },
};

export type UserRepository = typeof userRepository;
