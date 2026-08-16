import { Module } from '@nestjs/common';

import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { ClerkWebhooksController } from './webhooks.controller';

@Module({
  controllers: [UsersController, ClerkWebhooksController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
