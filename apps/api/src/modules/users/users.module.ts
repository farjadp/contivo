import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ClerkWebhooksController } from './webhooks.controller';

@Module({
  controllers: [UsersController, ClerkWebhooksController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
