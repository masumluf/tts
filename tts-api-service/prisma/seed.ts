/**
 * Seed script: creates a test user and prints a fresh API key.
 * The raw key is shown ONCE (only its hash is stored). Run with `npm run seed`.
 */
import { prisma } from '../src/config/prisma';
import { generateApiKey, hashApiKey } from '../src/auth/auth.service';

async function main(): Promise<void> {
  const apiKey = generateApiKey();
  const user = await prisma.user.create({
    data: {
      name: 'Test User',
      email: `test+${Date.now()}@tts.local`,
      apiKeyHash: hashApiKey(apiKey),
      rateLimitPerMinute: 60,
      monthlyQuota: 1000,
    },
  });

  // eslint-disable-next-line no-console
  console.log('\n✅ Created user');
  // eslint-disable-next-line no-console
  console.log(`   id:    ${user.id}`);
  // eslint-disable-next-line no-console
  console.log(`   email: ${user.email}`);
  // eslint-disable-next-line no-console
  console.log(`\n🔑 API key (save it now — only the hash is stored):\n   ${apiKey}\n`);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
