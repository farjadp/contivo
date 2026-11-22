/**
 * telegram.controller.ts
 *
 * Routes (prefix /api/v1):
 *   POST /social/telegram/connect-sessions            { workspaceId }  → 201 { sessionId, deepLink, expiresAt }
 *   GET  /social/telegram/connect-sessions/:id                         → 200 TelegramSessionView
 *   POST /social/telegram/connect-sessions/:id/confirm { code }        → 200 TelegramSessionView (status connected)
 *   POST /social/telegram/connect-sessions/:id/username { username }   → 200 TelegramSessionView (status pending_confirm)
 *   POST /social/telegram/webhook   @Public, X-Telegram-Bot-Api-Secret-Token → 200 { ok: true }
 *
 * The session routes use the global SessionAuthGuard (bearer minted by a web
 * server action); only the user who created a session can read or confirm it.
 * Error bodies carry a stable `code` (see TelegramConnectService).
 *
 * The webhook answers 200 at once and handles the update afterwards: Telegram
 * re-sends on anything else, and a slow handler must not block its queue.
 */

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';

import { CurrentUser, AuthenticatedUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';

import type { TgUpdate } from './telegram-bot.client';
import { TelegramConnectService } from './telegram-connect.service';

@Controller('social/telegram')
export class TelegramController {
  private readonly logger = new Logger(TelegramController.name);

  constructor(private readonly connect: TelegramConnectService) {}

  @Post('connect-sessions')
  createSession(@Body() body: { workspaceId?: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.connect.createSession(String(body?.workspaceId ?? ''), user.id);
  }

  @Get('connect-sessions/:id')
  getSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.connect.getSession(id, user.id);
  }

  @Post('connect-sessions/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @Body() body: { code?: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.connect.confirm(id, user.id, String(body?.code ?? ''));
  }

  @Post('connect-sessions/:id/username')
  @HttpCode(200)
  byUsername(@Param('id') id: string, @Body() body: { username?: string }, @CurrentUser() user: AuthenticatedUser) {
    return this.connect.connectByUsername(id, user.id, String(body?.username ?? ''));
  }

  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(@Headers('x-telegram-bot-api-secret-token') secret: string | undefined, @Body() update: TgUpdate) {
    if (!this.connect.checkWebhookSecret(secret)) {
      this.logger.warn('Telegram webhook refused: missing or wrong secret token');
      throw new UnauthorizedException();
    }
    setImmediate(() => {
      this.connect.handleUpdate(update).catch((e) => this.logger.error(`Telegram update failed: ${(e as Error).message}`));
    });
    return { ok: true };
  }
}
