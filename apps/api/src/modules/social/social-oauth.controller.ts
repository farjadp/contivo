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
 *     → Checks state + nonce cookie, exchanges the code, parks the account and
 *       redirects to the web /connections?pending=<ticket> (nothing saved yet).
 *
 *   POST /api/v1/social/oauth/finalize { ticket }
 *     → Session-authenticated (minted bearer from a web server action). Saves
 *       the parked connection only if the session user started the flow.
 *
 * Authentication:
 *   /connect: short-lived handoff token signed by the web app.
 *   /callback: encrypted state + the nonce cookie set by /connect (single use).
 *   /finalize: the web session (SessionAuthGuard). This is the step that binds
 *   the flow to the person who is signed in, which the API host cannot
 *   otherwise see — see social-oauth.service.ts.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Param,
  Post,
  Query,
  Redirect,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';

import { verifyHandoffToken } from './connect-handoff';
import { SocialConnectionsService } from './social-connections.service';
import { OAUTH_NONCE_COOKIE, SocialOAuthService, STATE_TTL_MS } from './social-oauth.service';

/**
 * The nonce cookie lives on the API host: the browser navigates to the API for
 * /connect (cookie set) and the provider sends it back to the API for
 * /callback (cookie read). SameSite=Lax is sent on that top-level GET
 * redirect from the provider; Strict would not be.
 */
const NONCE_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/v1/social/oauth',
};

export function readCookie(req: Pick<Request, 'headers'>, name: string): string | undefined {
  const header = req.headers?.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > -1 && part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

type Platform = 'linkedin' | 'x' | 'facebook' | 'tiktok';

@Controller('social/oauth')
export class SocialOAuthController {
  private readonly logger = new Logger(SocialOAuthController.name);

  constructor(
    private readonly oauthService: SocialOAuthService,
    private readonly connections: SocialConnectionsService,
  ) {}

  /**
   * Which platforms this deployment can actually connect.
   *
   * Exists so the Connections page can say "X is not set up on this
   * deployment" instead of offering a Connect button that lands the user on a
   * platform error page they cannot act on.
   */
  @Get('config')
  platformConfig() {
    return { platforms: this.oauthService.configuredPlatforms() };
  }

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
    @Res({ passthrough: true }) res: Response,
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

    const { url, nonce } = this.oauthService.startAuth(platform, targetWorkspaceId, handoff.userId);
    res.cookie(OAUTH_NONCE_COOKIE, nonce, { ...NONCE_COOKIE_OPTS, maxAge: STATE_TTL_MS });
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
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Query('error') error?: string,
  ) {
    const cookieNonce = readCookie(req, OAUTH_NONCE_COOKIE);
    // Single use either way: success, denial or failure ends this attempt.
    res.clearCookie(OAUTH_NONCE_COOKIE, NONCE_COOKIE_OPTS);

    if (error) {
      this.logger.warn(`OAuth denied: ${platform} error=${error}`);
      const webUrl = process.env.WEB_APP_URL ?? 'http://localhost:3000';
      return { url: `${webUrl}/connections?error=${encodeURIComponent(error)}`, statusCode: 302 };
    }

    const redirectUrl = await this.oauthService.handleCallback(platform, code, state, cookieNonce);
    return { url: redirectUrl, statusCode: 302 };
  }

  /**
   * Step 3 — the signed-in web session confirms the parked connection.
   * Called by a web server action with a bearer minted from the session.
   */
  @Post('finalize')
  @HttpCode(200)
  async finalize(
    @Body() body: { ticket?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.oauthService.finalizeConnect(String(body?.ticket ?? ''), user.id);
  }
}
