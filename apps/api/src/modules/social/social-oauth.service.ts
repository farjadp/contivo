/**
 * social-oauth.service.ts
 *
 * Handles OAuth 2.0 flows for all supported social platforms.
 *
 * Flow:
 *   1. Frontend → GET /social/oauth/:platform/connect?workspaceId=xxx
 *      → getAuthUrl() → 302 redirect to platform authorization page
 *
 *   2. Platform → GET /social/oauth/:platform/callback?code=yyy&state=zzz
 *      → handleCallback() → exchange code for token → save connection → redirect to frontend
 *
 * CSRF protection: workspaceId is embedded in a signed state param (HMAC-SHA256).
 *
 * Security:
 *   - Client secrets only live server-side (NestJS env).
 *   - Tokens are immediately encrypted via SocialConnectionsService before DB write.
 *   - The access token is never logged or returned to the frontend.
 */

import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as crypto from 'crypto';
import { SocialConnectionsService } from './social-connections.service';
import { PrismaService } from '../../common/prisma/prisma.service';

// ─── Platform config helper ───────────────────────────────────────────────────

type Platform = 'linkedin' | 'x' | 'facebook' | 'tiktok';

@Injectable()
export class SocialOAuthService {
  private readonly logger = new Logger(SocialOAuthService.name);

  constructor(
    private readonly connections: SocialConnectionsService,
    private readonly prisma: PrismaService,
  ) {}

  // ─── Step 1: Build redirect URL ──────────────────────────────────────────

  getAuthUrl(platform: Platform, workspaceId: string): string {
    switch (platform) {
      case 'linkedin': return this.linkedInAuthUrl(workspaceId);
      case 'x':        return this.xAuthUrl(workspaceId);
      case 'facebook': return this.facebookAuthUrl(workspaceId);
      case 'tiktok':   return this.tikTokAuthUrl(workspaceId);
      default:         throw new BadRequestException(`Unsupported platform: ${platform}`);
    }
  }

  // ─── Step 2: Handle callback ─────────────────────────────────────────────

  async handleCallback(
    platform: Platform,
    code: string,
    stateParam: string,
  ): Promise<string> {
    const stateObj = this.verifyState(stateParam);
    const workspaceId = stateObj.workspaceId;

    switch (platform) {
      case 'linkedin': return this.linkedInCallback(workspaceId, code);
      case 'x':        return this.xCallback(workspaceId, code, stateObj.codeVerifier);
      case 'facebook': return this.facebookCallback(workspaceId, code);
      case 'tiktok':   return this.tikTokCallback(workspaceId, code);
      default:         throw new BadRequestException(`Unsupported platform: ${platform}`);
    }
  }

  // ─── LinkedIn ─────────────────────────────────────────────────────────────

  private linkedInAuthUrl(workspaceId: string): string {
    const state = this.buildState(workspaceId);
    const clientId    = process.env.LINKEDIN_CLIENT_ID!;
    const redirectUri = process.env.LINKEDIN_REDIRECT_URI!;
    const scopes      = ['openid', 'profile', 'email', 'w_member_social'].join(' ');

    const params = new URLSearchParams({
      response_type: 'code',
      client_id:     clientId,
      redirect_uri:  redirectUri,
      state,
      scope:         scopes,
    });

    return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
  }

  private async linkedInCallback(workspaceId: string, code: string): Promise<string> {
    const clientId     = process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
    const redirectUri  = process.env.LINKEDIN_REDIRECT_URI!;

    // Exchange code for token
    const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        client_id:     clientId,
        client_secret: clientSecret,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new BadRequestException(`LinkedIn token exchange failed: ${err}`);
    }

    const { access_token, refresh_token, expires_in } = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Fetch user info (OpenID Connect userinfo endpoint)
    const userRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });

    if (!userRes.ok) throw new BadRequestException('Failed to fetch LinkedIn user info');

    const user = await userRes.json() as {
      sub: string;      // LinkedIn member URN ID
      name?: string;
      email?: string;
    };

    const tokenExpiresAt = expires_in
      ? new Date(Date.now() + expires_in * 1000)
      : undefined;

    await this.connections.create({
      workspaceId,
      platform:          'LINKEDIN',
      accountName:       user.name ?? user.email ?? 'LinkedIn Account',
      accountIdentifier: user.sub,
      accessToken:       access_token,
      refreshToken:      refresh_token,
      tokenExpiresAt,
      scopes:            ['openid', 'profile', 'email', 'w_member_social'],
      isDefault:         true,
    });

    this.logger.log(`LinkedIn connected: workspace=${workspaceId} sub=${user.sub}`);
    return `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/connections?connected=linkedin`;
  }

  // ─── X (Twitter) ─────────────────────────────────────────────────────────

  private xAuthUrl(workspaceId: string): string {
    const clientId    = process.env.TWITTER_CLIENT_ID!;
    const redirectUri = process.env.TWITTER_REDIRECT_URI!;
    const scopes      = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const state = this.buildState(workspaceId, { codeVerifier });

    const params = new URLSearchParams({
      response_type:         'code',
      client_id:             clientId,
      redirect_uri:          redirectUri,
      state,
      scope:                 scopes,
      code_challenge:        codeChallenge,
      code_challenge_method: 'S256',
    });

    return `https://twitter.com/i/oauth2/authorize?${params.toString()}`;
  }

  private async xCallback(workspaceId: string, code: string, codeVerifier: string): Promise<string> {
    const clientId     = process.env.TWITTER_CLIENT_ID!;
    const clientSecret = process.env.TWITTER_CLIENT_SECRET!;
    const redirectUri  = process.env.TWITTER_REDIRECT_URI!;

    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

    const tokenRes = await fetch('https://api.twitter.com/2/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        Authorization:   `Basic ${credentials}`,
      },
      body: new URLSearchParams({
        grant_type:    'authorization_code',
        code,
        redirect_uri:  redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new BadRequestException(`X token exchange failed: ${err}`);
    }

    const { access_token, refresh_token, expires_in } = await tokenRes.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    // Fetch user info
    const userRes = await fetch('https://api.twitter.com/2/users/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const { data: xUser } = await userRes.json() as { data: { id: string; name: string; username: string } };

    const tokenExpiresAt = expires_in ? new Date(Date.now() + expires_in * 1000) : undefined;

    await this.connections.create({
      workspaceId,
      platform:          'X',
      accountName:       `@${xUser.username}`,
      accountIdentifier: xUser.id,
      accessToken:       access_token,
      refreshToken:      refresh_token,
      tokenExpiresAt,
      scopes:            ['tweet.read', 'tweet.write', 'users.read'],
      isDefault:         true,
    });

    this.logger.log(`X connected: workspace=${workspaceId} user=@${xUser.username}`);
    return `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/connections?connected=x`;
  }

  // ─── Facebook ─────────────────────────────────────────────────────────────

  private facebookAuthUrl(workspaceId: string): string {
    const state = this.buildState(workspaceId);
    const appId       = process.env.FACEBOOK_APP_ID!;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI!;
    const scopes      = ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'].join(',');

    const params = new URLSearchParams({
      client_id:     appId,
      redirect_uri:  redirectUri,
      state,
      scope:         scopes,
      response_type: 'code',
    });

    return `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
  }

  private async facebookCallback(workspaceId: string, code: string): Promise<string> {
    const appId       = process.env.FACEBOOK_APP_ID!;
    const appSecret   = process.env.FACEBOOK_APP_SECRET!;
    const redirectUri = process.env.FACEBOOK_REDIRECT_URI!;

    // Exchange code for user token
    const tokenUrl = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
    tokenUrl.searchParams.set('client_id',     appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('redirect_uri',  redirectUri);
    tokenUrl.searchParams.set('code',          code);

    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new BadRequestException(`Facebook token exchange failed: ${err}`);
    }

    const { access_token } = await tokenRes.json() as { access_token: string };

    // Get user info
    const meRes = await fetch(`https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${access_token}`);
    const fbUser = await meRes.json() as { id: string; name: string };

    const pagesRes = await fetch(
      `https://graph.facebook.com/v19.0/${fbUser.id}/accounts?access_token=${access_token}`,
    );
    const { data: pages } = await pagesRes.json() as {
      data: Array<{ id: string; name: string; access_token: string }>;
    };

    if (!pages || pages.length === 0) {
      this.logger.warn(`Facebook connected but no pages found for workspace=${workspaceId}`);
      throw new BadRequestException('No Facebook Pages found. Please ensure you selected a Page during authorization.');
    }

    // Save a connection for every Page the user authorized
    for (const page of pages) {
      // Check if connection already exists to avoid duplicates
      const existing = await this.prisma.socialConnection.findFirst({
        where: { workspaceId, platform: 'FACEBOOK', accountIdentifier: page.id },
      });

      if (existing) {
        // Update token if it already exists
        await this.prisma.socialConnection.update({
          where: { id: existing.id },
          data: {
            encryptedAccessTokenRef: this.connections.encryptToken(page.access_token),
            status: 'CONNECTED',
          },
        });
        this.logger.log(`Facebook page updated: workspace=${workspaceId} page=${page.name}`);
      } else {
        await this.connections.create({
          workspaceId,
          platform:          'FACEBOOK',
          accountName:       page.name,
          accountIdentifier: page.id,
          accessToken:       page.access_token,
          scopes:            ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
          isDefault:         pages.indexOf(page) === 0, // First page is default if none exist
        });
        this.logger.log(`Facebook page connected: workspace=${workspaceId} page=${page.name}`);
      }
    }

    return `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/connections?connected=facebook`;
  }

  // ─── TikTok ───────────────────────────────────────────────────────────────

  private tikTokAuthUrl(workspaceId: string): string {
    const state = this.buildState(workspaceId);
    const clientKey  = process.env.TIKTOK_CLIENT_KEY!;
    const redirectUri = process.env.TIKTOK_REDIRECT_URI!;
    // Required scopes for content posting
    const scopes = ['user.info.basic', 'video.publish', 'video.upload'].join(',');

    const params = new URLSearchParams({
      client_key:    clientKey,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         scopes,
      state,
    });

    return `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
  }

  private async tikTokCallback(workspaceId: string, code: string): Promise<string> {
    const clientKey    = process.env.TIKTOK_CLIENT_KEY!;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET!;
    const redirectUri  = process.env.TIKTOK_REDIRECT_URI!;

    // Exchange code for token
    const tokenRes = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        'client_key':    clientKey,
        client_secret:   clientSecret,
        code,
        grant_type:      'authorization_code',
        redirect_uri:    redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      throw new BadRequestException(`TikTok token exchange failed: ${err}`);
    }

    const tokenData = await tokenRes.json() as {
      access_token:  string;
      refresh_token: string;
      expires_in:    number;
      open_id:       string;
    };

    // Fetch user info
    const userRes = await fetch(
      'https://open.tiktokapis.com/v2/user/info/?fields=display_name,avatar_url',
      { headers: { Authorization: `Bearer ${tokenData.access_token}` } },
    );

    const userJson = await userRes.json() as {
      data?: { user?: { display_name?: string; open_id?: string } };
    };

    const displayName = userJson.data?.user?.display_name ?? 'TikTok Account';
    const openId      = tokenData.open_id;
    const tokenExpiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

    await this.connections.create({
      workspaceId,
      platform:          'TIKTOK',
      accountName:       displayName,
      accountIdentifier: openId,
      accessToken:       tokenData.access_token,
      refreshToken:      tokenData.refresh_token,
      tokenExpiresAt,
      scopes:            ['user.info.basic', 'video.publish', 'video.upload'],
      isDefault:         true,
    });

    this.logger.log(`TikTok connected: workspace=${workspaceId} open_id=${openId}`);
    return `${process.env.WEB_APP_URL ?? 'http://localhost:3000'}/connections?connected=tiktok`;
  }

  // ─── State helpers (CSRF) ────────────────────────────────────────────────

  private buildState(workspaceId: string, extraData: Record<string, string> = {}): string {
    const secret = process.env.OAUTH_STATE_SECRET ?? 'contivo-oauth-state-secret';
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(12);

    const payloadObj = { workspaceId, ts: Date.now(), ...extraData };
    const payloadBuffer = Buffer.from(JSON.stringify(payloadObj), 'utf8');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes

    // pack as: iv(12) + authTag(16) + ciphertext
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
  }

  private verifyState(stateParam: string): Record<string, any> {
    try {
      const secret = process.env.OAUTH_STATE_SECRET ?? 'contivo-oauth-state-secret';
      const key = crypto.createHash('sha256').update(secret).digest();

      const packed = Buffer.from(stateParam, 'base64url');
      if (packed.length < 28) throw new Error('State too short');

      const iv = packed.subarray(0, 12);
      const authTag = packed.subarray(12, 28);
      const ciphertext = packed.subarray(28);

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      const payloadObj = JSON.parse(decrypted.toString('utf8'));

      if (Date.now() - payloadObj.ts > 10 * 60 * 1000) {
        throw new Error('State expired');
      }

      return payloadObj;
    } catch (err) {
      throw new BadRequestException(`Invalid OAuth state: ${(err as Error).message}`);
    }
  }
}
