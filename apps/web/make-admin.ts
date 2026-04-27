import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = 'dev@contivo.app';
  
  // Find user by email
  const user = await prisma.user.findFirst({
    where: { email }
  });

  if (!user) {
    console.error(`User with email ${email} not found in the database. Ensure you have signed up via Clerk first.`);
    process.exit(1);
  }

  // Update role
  await prisma.user.update({
    where: { id: user.id },
    data: { role: 'ADMIN' }
  });

  console.log(`Successfully upgraded ${email} to ADMIN role.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
