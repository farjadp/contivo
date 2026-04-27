import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: buildDatasourceUrl()
        ? {
            db: { url: buildDatasourceUrl() },
          }
        : undefined,
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Prisma connected to database');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Prisma disconnected from database');
  }
}
