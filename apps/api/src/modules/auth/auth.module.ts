import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { SessionAuthGuard } from './guards/session-auth.guard';

@Module({
  providers: [
    {
      provide: APP_GUARD,
      useClass: SessionAuthGuard,
    },
  ],
})
export class AuthModule {}
