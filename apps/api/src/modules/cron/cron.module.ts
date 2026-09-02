import { Module } from '@nestjs/common';

import { WebCronService } from './web-cron.service';

@Module({
  providers: [WebCronService],
})
export class CronModule {}
