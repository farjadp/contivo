import { PrismaClient } from '@prisma/client';

declare global {
  var prisma: PrismaClient | undefined;
}

function buildDatasourceUrl() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    return undefined;
  }

  const shouldUseDedicatedSchema =
    process.env.VERCEL === '1' && !databaseUrl.includes('schema=');

  if (!shouldUseDedicatedSchema) {
    return databaseUrl;
  }

  const separator = databaseUrl.includes('?') ? '&' : '?';
  return `${databaseUrl}${separator}schema=contivo`;
}

const datasourceUrl = buildDatasourceUrl();

export const prisma =
  global.prisma ||
  new PrismaClient(
    datasourceUrl
      ? {
          datasources: {
            db: { url: datasourceUrl },
          },
        }
      : undefined,
  );

if (process.env.NODE_ENV !== 'production') global.prisma = prisma;
