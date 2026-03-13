import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding Contivo database...');

  // ─── Dev admin user ──────────────────────────────────────────────────────────
  const devUser = await prisma.user.upsert({
    where: { email: 'dev@contivo.app' },
    update: {
      passwordHash: '$2b$10$V1n5OmNPjxmA1QMgqE41kuPOlnbOwYgBQF4D07G6k2ObPItkQ1xG6', // password123
      role: 'ADMIN',
      plan: 'PRO',
    },
    create: {
      passwordHash: '$2b$10$V1n5OmNPjxmA1QMgqE41kuPOlnbOwYgBQF4D07G6k2ObPItkQ1xG6', // password123
      email: 'dev@contivo.app',
      name: 'Contivo Dev',
      plan: 'PRO',
      role: 'ADMIN',
    },
  });

  console.log(`✅ Created dev user: ${devUser.email} (id: ${devUser.id})`);

  // ─── Seed initial credit allocation ─────────────────────────────────────────
  const existingLedger = await prisma.creditLedger.count({
    where: { userId: devUser.id, type: 'ALLOCATION' },
  });

  if (existingLedger === 0) {
    await prisma.creditLedger.create({
      data: {
        userId: devUser.id,
        type: 'ALLOCATION',
        feature: 'ALLOCATION',
        amount: 100,
        balanceAfter: 100,
      },
    });
    console.log('✅ Seeded 100 dev credits');
  }

  // ─── Sample workspace ────────────────────────────────────────────────────────
  const workspace = await prisma.workspace.upsert({
    where: {
      id: 'seed-workspace-01',
    },
    update: {},
    create: {
      id: 'seed-workspace-01',
      userId: devUser.id,
      name: 'Contivo (Demo)',
      websiteUrl: 'https://contivo.app',
      status: 'READY',
      brandSummary: {
        summary:
          'Contivo is an AI-powered SaaS platform for content generation and marketing workflows.',
        tone: 'Professional yet approachable',
        keywords: ['AI content', 'marketing', 'content strategy', 'SaaS'],
      },
      audienceInsights: {
        description: 'B2B founders, marketers, and content managers at SMBs',
        painPoints: [
          'Not enough time to create consistent content',
          'Difficulty maintaining brand voice at scale',
        ],
        goals: ['Build thought leadership', 'Drive inbound leads through content'],
      },
    },
  });

  console.log(`✅ Created sample workspace: ${workspace.name}`);

  console.log('\n✨ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
