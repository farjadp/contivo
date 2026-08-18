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

import { Controller, Get, Param, Query, Redirect, Logger, UnauthorizedException } from '@nestjs/common';

import { Public } from '../auth/decorators/public.decorator';

import { verifyHandoffToken } from './connect-handoff';
import { SocialConnectionsService } from './social-connections.service';
import { SocialOAuthService } from './social-oauth.service';

type Platform = 'linkedin' | 'x' | 'facebook' | 'tiktok';

@Controller('social/oauth')
export class SocialOAuthController {
  private readonly logger = new Logger(SocialOAuthController.name);

  constructor(
    private readonly oauthService: SocialOAuthService,
    private readonly connections: SocialConnectionsService,
  ) {}

  /**
   * Step 1 — initiate OAuth.
   *
   * Reached by a browser navigation from the Connect button, which cannot
   * send an Authorization header, so this route is @Public and authenticates
   * with a short-lived signed handoff token minted by the web app instead.
   * Returns a 302 redirect to the platform's authorization page.
   */
  @Public()
  @Get(':platform/connect')
  @Redirect()
  async initiateOAuth(
    @Param('platform') platform: Platform,
    @Query('workspaceId') workspaceId: string,
    @Query('t') handoffToken?: string,
  ) {
    const handoff = verifyHandoffToken(handoffToken);
    if (!handoff) {
      this.logger.warn(`OAuth connect rejected: missing or invalid handoff token (${platform})`);
      throw new UnauthorizedException('Invalid or expired connect link. Reopen the Connections page and try again.');
    }
    const targetWorkspaceId = workspaceId || handoff.workspaceId;
    if (targetWorkspaceId !== handoff.workspaceId) {
      throw new UnauthorizedException('Connect link does not match the requested workspace.');
    }
    await this.connections.validateWorkspaceAccess(targetWorkspaceId, handoff.userId);

    const url = this.oauthService.getAuthUrl(platform, targetWorkspaceId);
    this.logger.log(`OAuth initiated: ${platform} workspace=${targetWorkspaceId}`);
    return { url, statusCode: 302 };
  }

  /**
   * Step 2 — handle platform callback.
   *
   * The provider redirects the user's browser here, so like /connect it can
   * carry no Authorization header and must be @Public. Its authentication is
   * the `state` parameter: AES-GCM encrypted and issued by us in step 1, so a
   * forged callback cannot name a workspace we did not authorise.
   *
   * Exchanges the code for a token, saves the connection, then redirects
   * the user back to the frontend /connections page.
   */
  @Public()
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
