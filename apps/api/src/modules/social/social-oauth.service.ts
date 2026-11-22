/**
 * social-oauth.service.ts
 *
 * Handles OAuth 2.0 flows for all supported social platforms.
 *
 * Flow:
 *   1. Web → GET /social/oauth/:platform/connect?t=<handoff>
 *      → startAuth() → nonce cookie on the API host + 302 to the platform
 *
 *   2. Platform → GET /social/oauth/:platform/callback?code=yyy&state=zzz
 *      → handleCallback() → checks state + nonce cookie, exchanges the code,
 *        PARKS the account in Redis under a one-time ticket and redirects to
 *        the web /connections?pending=<ticket>. Nothing is saved yet.
 *
 *   3. Web (signed-in session) → POST /social/oauth/finalize { ticket }
 *      → finalizeConnect() → saves the connection only if the session user is
 *        the user who started step 1.
 *
 * Why step 3: the API host cannot see the contivo.app session cookie, so the
 * nonce cookie only proves "the same browser that opened /connect". An
 * attacker can mint a valid /connect link for their own workspace and send it
 * to a victim; without step 3 the victim's LinkedIn landed in the attacker's
 * workspace (connection CSRF). Step 3 is checked against the web session.
 *
 * Security:
 *   - Client secrets only live server-side (NestJS env).
 *   - Tokens are encrypted (token-crypto) before they are parked or saved.
 *   - The access token is never logged or returned to the frontend.
 */

import * as crypto from 'crypto';

import {
  BadRequestException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import type { CreateSocialConnectionDto } from './dto/create-social-connection.dto';
import { getOAuthStateSecret } from './oauth-state-secret';
import { OAUTH_STORE, type OAuthStore } from './oauth-store';
import type { OAuthPlatform } from './platforms';
import { SocialConnectionsService } from './social-connections.service';
import * as tokenCrypto from './token-crypto';

/** OAuth state lifetime; the nonce cookie and the pending ticket live as long. */
export const STATE_TTL_MS = 10 * 60 * 1000;
export const OAUTH_NONCE_COOKIE = 'contivo_oauth_nonce';

interface StateContext {
  workspaceId: string;
  userId: string;
  platform: Platform;
  nonce: string;
}

/** What a platform callback learned, before it is bound to a workspace. */
type ExchangedAccount = Omit<CreateSocialConnectionDto, 'workspaceId'>;

/** Parked in Redis between the callback and the web confirmation. */
interface PendingConnect {
  userId: string;
  workspaceId: string;
  platform: Platform;
  accounts: Array<
    Omit<ExchangedAccount, 'accessToken' | 'refreshToken' | 'tokenExpiresAt'> & {
      encAccess: string;
      encRefresh?: string;
      tokenExpiresAt?: string;
    }
  >;
}

const pendingKey = (ticket: string) => `social:oauth-pending:${ticket}`;
const nonceKey = (nonce: string) => `social:oauth-state:${nonce}`;

// ─── Platform config helper ───────────────────────────────────────────────────

// OAuth platforms come from platforms.ts (typed against the Prisma enum).
type Platform = OAuthPlatform;

@Injectable()
export class SocialOAuthService {
  private readonly logger = new Logger(SocialOAuthService.name);

  constructor(
    private readonly connections: SocialConnectionsService,
    @Inject(OAUTH_STORE) private readonly store: OAuthStore,
  ) {
    // Fail at boot, not on the first connect attempt.
    getOAuthStateSecret();
  }

  // ─── Step 1: Build redirect URL ──────────────────────────────────────────

  /**
   * Which env vars each platform's OAuth flow needs. Without this the service
   * happily built `client_id=undefined` and sent the user to a platform error
   * page, so a deployment that had simply never been given X credentials was
   * indistinguishable from a genuine OAuth failure.
   */
  private static readonly REQUIRED_ENV: Record<Platform, string[]> = {
    linkedin: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'LINKEDIN_REDIRECT_URI'],
    x: ['TWITTER_CLIENT_ID', 'TWITTER_CLIENT_SECRET', 'TWITTER_REDIRECT_URI'],
    facebook: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_REDIRECT_URI'],
    tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'],
  };

  /** Env vars this deployment is missing for a platform. Empty means ready. */
  missingConfig(platform: Platform): string[] {
    const required = SocialOAuthService.REQUIRED_ENV[platform] ?? [];
    return required.filter((key) => !process.env[key]?.trim());
  }

  /** Configuration status for every platform, for the Connections UI. */
  configuredPlatforms(): Record<Platform, boolean> {
    const platforms = Object.keys(SocialOAuthService.REQUIRED_ENV) as Platform[];
    return Object.fromEntries(
      platforms.map((p) => [p, this.missingConfig(p).length === 0]),
    ) as Record<Platform, boolean>;
  }

  /**
   * Starts a connect flow for `userId` into `workspaceId`. The returned
   * `nonce` must be set by the controller as an httpOnly cookie on the API
   * host; the callback only proceeds in the browser that holds it.
   */
  startAuth(platform: Platform, workspaceId: string, userId: string): { url: string; nonce: string } {
    const missing = this.missingConfig(platform);
    if (missing.length > 0) {
      this.logger.error(`OAuth blocked: ${platform} is missing ${missing.join(', ')}`);
      throw new BadRequestException(
        `${platform} is not configured on this deployment. Missing: ${missing.join(', ')}.`,
      );
    }

    const ctx: StateContext = {
      workspaceId,
      userId,
      platform,
      nonce: crypto.randomBytes(18).toString('base64url'),
    };
    let url: string;
    switch (platform) {
      case 'linkedin': url = this.linkedInAuthUrl(ctx); break;
      case 'x':        url = this.xAuthUrl(ctx); break;
      case 'facebook': url = this.facebookAuthUrl(ctx); break;
      case 'tiktok':   url = this.tikTokAuthUrl(ctx); break;
      default:         throw new BadRequestException(`Unsupported platform: ${platform}`);
    }
    return { url, nonce: ctx.nonce };
  }

  // ─── Step 2: Handle callback ─────────────────────────────────────────────

  /**
   * Checks, before any code is exchanged: the state decrypts and is fresh;
   * it was issued for this platform; the browser holds the nonce cookie set
   * at /connect; the nonce was not used before. Then exchanges the code and
   * parks the account for finalizeConnect(). Returns the web URL to go to.
   */
  async handleCallback(
    platform: Platform,
    code: string,
    stateParam: string,
    cookieNonce: string | undefined,
  ): Promise<string> {
    const stateObj = this.verifyState(stateParam);
    const { workspaceId, userId, nonce } = stateObj as Partial<StateContext>;

    if (stateObj.platform !== platform) {
      throw new BadRequestException('This sign-in was started for a different platform. Start the connection again.');
    }
    if (!workspaceId || !userId || !nonce || !cookieNonce || !this.sameNonce(nonce, cookieNonce)) {
      this.logger.warn(`OAuth callback rejected: nonce cookie missing or mismatched (${platform})`);
      throw new BadRequestException(
        'This sign-in did not start in this browser, or it took too long. Start the connection again from the Connections page.',
      );
    }
    if (!(await this.store.claimOnce(nonceKey(nonce), STATE_TTL_MS + 60_000))) {
      throw new BadRequestException('This sign-in link was already used. Start the connection again from the Connections page.');
    }

    let accounts: ExchangedAccount[];
    switch (platform) {
      case 'linkedin': accounts = await this.linkedInCallback(workspaceId, code); break;
      case 'x':        accounts = await this.xCallback(workspaceId, code, stateObj.codeVerifier); break;
      case 'facebook': accounts = await this.facebookCallback(workspaceId, code); break;
      case 'tiktok':   accounts = await this.tikTokCallback(workspaceId, code); break;
      default:         throw new BadRequestException(`Unsupported platform: ${platform}`);
    }

    const pending: PendingConnect = {
      userId,
      workspaceId,
      platform,
      accounts: accounts.map(({ accessToken, refreshToken, tokenExpiresAt, ...rest }) => ({
        ...rest,
        encAccess: tokenCrypto.encryptToken(accessToken),
        ...(refreshToken && { encRefresh: tokenCrypto.encryptToken(refreshToken) }),
        ...(tokenExpiresAt && { tokenExpiresAt: tokenExpiresAt.toISOString() }),
      })),
    };
    const ticket = crypto.randomBytes(24).toString('base64url');
    await this.store.put(pendingKey(ticket), JSON.stringify(pending), STATE_TTL_MS);

    this.logger.log(`OAuth callback parked: ${platform} workspace=${workspaceId} accounts=${accounts.length}`);
    const web = process.env.WEB_APP_URL ?? 'http://localhost:3000';
    return `${web}/connections?pending=${encodeURIComponent(ticket)}&platform=${platform}`;
  }

  // ─── Step 3: Confirm from the web session ─────────────────────────────────

  /**
   * Saves a parked connection, but only for the user who started the flow.
   * The ticket is consumed on the first attempt whatever the outcome, so a
   * mismatched attempt (a victim's browser landing on an attacker's flow)
   * destroys it and the attacker cannot finalize it afterwards.
   */
  async finalizeConnect(ticket: string, sessionUserId: string): Promise<{ platform: Platform; accounts: number }> {
    if (!ticket || typeof ticket !== 'string') throw new BadRequestException('ticket is required.');
    const raw = await this.store.take(pendingKey(ticket));
    if (!raw) throw new GoneException('This connection attempt expired or was already used. Connect again.');

    const pending = JSON.parse(raw) as PendingConnect;
    if (pending.userId !== sessionUserId) {
      this.logger.warn(
        `OAuth finalize refused: ${pending.platform} flow for workspace=${pending.workspaceId} was started by another user`,
      );
      throw new ForbiddenException(
        'This connection was started from another Contivo account. Nothing was connected. Start again from your Connections page.',
      );
    }
    await this.connections.validateWorkspaceAccess(pending.workspaceId, sessionUserId);

    for (const acct of pending.accounts) {
      const { encAccess, encRefresh, tokenExpiresAt, ...rest } = acct;
      const accessToken = tokenCrypto.decryptToken(encAccess);
      const refreshToken = encRefresh ? tokenCrypto.decryptToken(encRefresh) : undefined;
      const expires = tokenExpiresAt ? new Date(tokenExpiresAt) : undefined;

      // One upsert path: SocialConnectionsService.create() upserts on
      // (workspaceId, platform, accountIdentifier), so a reconnect keeps the
      // row id (publish history stays attached) instead of duplicating it.
      await this.connections.create({
        ...rest,
        workspaceId: pending.workspaceId,
        accessToken,
        refreshToken,
        tokenExpiresAt: expires,
      });
    }

    this.logger.log(
      `OAuth connected: ${pending.platform} workspace=${pending.workspaceId} accounts=${pending.accounts.length}`,
    );
    return { platform: pending.platform, accounts: pending.accounts.length };
  }

  private sameNonce(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }

  // ─── LinkedIn ─────────────────────────────────────────────────────────────

  private linkedInAuthUrl(ctx: StateContext): string {
    const state = this.buildState(ctx);
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

  private async linkedInCallback(_workspaceId: string, code: string): Promise<ExchangedAccount[]> {
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

    return [{
      platform:          'LINKEDIN',
      accountName:       user.name ?? user.email ?? 'LinkedIn Account',
      accountIdentifier: user.sub,
      accessToken:       access_token,
      refreshToken:      refresh_token,
      tokenExpiresAt,
      scopes:            ['openid', 'profile', 'email', 'w_member_social'],
      isDefault:         true,
    }];
  }

  // ─── X (Twitter) ─────────────────────────────────────────────────────────

  private xAuthUrl(ctx: StateContext): string {
    const clientId    = process.env.TWITTER_CLIENT_ID!;
    const redirectUri = process.env.TWITTER_REDIRECT_URI!;
    const scopes      = ['tweet.read', 'tweet.write', 'users.read', 'offline.access'].join(' ');

    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    const state = this.buildState(ctx, { codeVerifier });

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

  private async xCallback(_workspaceId: string, code: string, codeVerifier: string): Promise<ExchangedAccount[]> {
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

    return [{
      platform:          'X',
      accountName:       `@${xUser.username}`,
      accountIdentifier: xUser.id,
      accessToken:       access_token,
      refreshToken:      refresh_token,
      tokenExpiresAt,
      scopes:            ['tweet.read', 'tweet.write', 'users.read'],
      isDefault:         true,
    }];
  }

  // ─── Facebook ─────────────────────────────────────────────────────────────

  private facebookAuthUrl(ctx: StateContext): string {
    const state = this.buildState(ctx);
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

  private async facebookCallback(workspaceId: string, code: string): Promise<ExchangedAccount[]> {
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

    // One connection per Page the user authorized; finalizeConnect() updates
    // a Page already connected to the workspace instead of duplicating it.
    return pages.map((page, i) => ({
      platform:          'FACEBOOK' as const,
      accountName:       page.name,
      accountIdentifier: page.id,
      accessToken:       page.access_token,
      scopes:            ['pages_manage_posts', 'pages_read_engagement', 'pages_show_list'],
      isDefault:         i === 0,
    }));
  }

  // ─── TikTok ───────────────────────────────────────────────────────────────

  private tikTokAuthUrl(ctx: StateContext): string {
    const state = this.buildState(ctx);
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

  private async tikTokCallback(_workspaceId: string, code: string): Promise<ExchangedAccount[]> {
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

    return [{
      platform:          'TIKTOK',
      accountName:       displayName,
      accountIdentifier: openId,
      accessToken:       tokenData.access_token,
      refreshToken:      tokenData.refresh_token,
      tokenExpiresAt,
      scopes:            ['user.info.basic', 'video.publish', 'video.upload'],
      isDefault:         true,
    }];
  }

  // ─── State helpers (CSRF) ────────────────────────────────────────────────

  private buildState(ctx: StateContext, extraData: Record<string, string> = {}): string {
    const secret = getOAuthStateSecret();
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(12);

    const payloadObj = { ...extraData, ...ctx, ts: Date.now() };
    const payloadBuffer = Buffer.from(JSON.stringify(payloadObj), 'utf8');

    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(payloadBuffer), cipher.final()]);
    const authTag = cipher.getAuthTag(); // 16 bytes

    // pack as: iv(12) + authTag(16) + ciphertext
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64url');
  }

  private verifyState(stateParam: string): Record<string, any> {
    try {
      const secret = getOAuthStateSecret();
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

      if (typeof payloadObj.ts !== 'number' || Date.now() - payloadObj.ts > STATE_TTL_MS) {
        throw new Error('State expired');
      }

      return payloadObj;
    } catch (err) {
      throw new BadRequestException(`Invalid OAuth state: ${(err as Error).message}`);
    }
  }
}
