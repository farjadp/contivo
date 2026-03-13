/**
 * social-oauth.controller.ts
 *
 * Handles the OAuth 2.0 browser-facing redirect flow.
 *
 * Routes:
 *   GET /api/v1/social/oauth/:platform/connect?workspaceId=xxx
 *     → Redirects user to the platform's OAuth authorization page.
 *
 *   GET /api/v1/social/oauth/:platform/callback?code=yyy&state=zzz
 *     → Exchanges code for token, saves connection, redirects user back to the
 *       frontend connections page with a success query param.
 *
 * Authentication:
 *   The /connect endpoint requires a valid workspaceId in the query.
 *   The /callback endpoint validates the HMAC-signed state param (no session needed).
 */

import { Controller, Get, Param, Query, Redirect, Logger } from '@nestjs/common';
import { SocialOAuthService } from './social-oauth.service';

type Platform = 'linkedin' | 'x' | 'facebook';

@Controller('social/oauth')
export class SocialOAuthController {
  private readonly logger = new Logger(SocialOAuthController.name);

  constructor(private readonly oauthService: SocialOAuthService) {}

  /**
   * Step 1 — initiate OAuth.
   * Called by the frontend's Connect button.
   * Returns a 302 redirect to the platform's authorization page.
   */
  @Get(':platform/connect')
  @Redirect()
  initiateOAuth(
    @Param('platform') platform: Platform,
    @Query('workspaceId') workspaceId: string,
  ) {
    const url = this.oauthService.getAuthUrl(platform, workspaceId);
    this.logger.log(`OAuth initiated: ${platform} workspace=${workspaceId}`);
    return { url, statusCode: 302 };
  }

  /**
   * Step 2 — handle platform callback.
   * The platform redirects here after user authorizes.
   * Exchanges the code for a token, saves the connection, then redirects
   * the user back to the frontend /connections page.
   */
  @Get(':platform/callback')
  @Redirect()
  async handleCallback(
    @Param('platform') platform: Platform,
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error?: string,
  ) {
    if (error) {
      this.logger.warn(`OAuth denied: ${platform} error=${error}`);
      const webUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';
      return { url: `${webUrl}/connections?error=${encodeURIComponent(error)}`, statusCode: 302 };
    }

    const redirectUrl = await this.oauthService.handleCallback(platform, code, state);
    return { url: redirectUrl, statusCode: 302 };
  }
}
