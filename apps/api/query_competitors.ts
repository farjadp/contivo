import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const competitors = await prisma.competitor.findMany({
    select: { id: true, name: true, domain: true, userDecision: true }
  });
  console.log(JSON.stringify(competitors, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
