import { Controller, Post, Req, Res, Headers, Logger, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { Webhook } from 'svix';
import { UsersService } from './users.service';
import { Public } from '../auth/decorators/public.decorator';

@Controller('webhooks/clerk')
export class ClerkWebhooksController {
  private readonly logger = new Logger(ClerkWebhooksController.name);

  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post()
  async handleWebhook(
    @Req() req: Request,
    @Res() res: Response,
    @Headers('svix-id') svixId?: string,
    @Headers('svix-timestamp') svixTimestamp?: string,
    @Headers('svix-signature') svixSignature?: string,
  ) {
    if (!svixId || !svixTimestamp || !svixSignature) {
      this.logger.error('Missing svix headers');
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: 'Missing svix headers',
      });
    }

    const payload = JSON.stringify(req.body);
    const headers = {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    };

    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
    if (!webhookSecret) {
      this.logger.error('CLERK_WEBHOOK_SECRET is missing');
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Webhook secret configuring error',
      });
    }

    const wh = new Webhook(webhookSecret);
    let evt: any;

    try {
      evt = wh.verify(payload, headers);
    } catch (err: any) {
      this.logger.error(`Error verifying webhook: ${err.message}`);
      return res.status(HttpStatus.BAD_REQUEST).json({
        success: false,
        message: err.message,
      });
    }

    // Process event
    const eventType = evt.type;
    const data = evt.data;

    if (eventType === 'user.created' || eventType === 'user.updated') {
      try {
        await this.usersService.upsertFromClerk(data);
        return res.status(HttpStatus.OK).json({ success: true });
      } catch (err) {
        this.logger.error(`Failed to process webhook event ${eventType} for user ${data.id}`);
        // Return 400 or 500 depending on error semantics, but 400 prevents svix from endless retries if it's a validation error
        return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Bad request processing user' });
      }
    }

    return res.status(HttpStatus.OK).json({ success: true, message: 'Ignored unhandled event type' });
  }
}
