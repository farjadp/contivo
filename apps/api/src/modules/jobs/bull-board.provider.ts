import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

const logger = new Logger('JobsRedisProvider');

export const redisConnection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

redisConnection.on('error', (err) => {
  logger.error(`Redis connection error: ${err.message}`);
});

redisConnection.on('ready', () => {
  logger.log('Redis connection established for BullMQ');
});
