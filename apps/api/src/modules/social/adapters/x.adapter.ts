/**
 * x.adapter.ts
 *
 * X (Twitter) v2 API adapter.
 *
 * MVP scope: single text tweet.
 * Thread support deferred to Phase 2.
 *
 * API reference: https://developer.twitter.com/en/docs/twitter-api/tweets/manage-tweets/api-reference/post-tweets
 * Auth: OAuth 2.0 Bearer token with tweet.write scope.
 *
 * NOTE: Real token injection happens in SocialPublishJobsService before calling
 *       this adapter. Never log or expose the accessToken.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';

import { validateX } from '../validators/platform-validator';

import {
  describeFetchError,
  failedPublishFromError,
  failedPublishResult,
  healthFromFetchError,
  healthFromStatus,
} from './http-health';
import {
  SocialAdapter,
  AdapterConnection,
  ConnectionHealth,
  CredentialKind,
  RefreshResult,
  PublishPayload,
  PublishResult,
  ValidationResult,
} from './social-adapter.interface';


@Injectable()
export class XAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'X';
  readonly credential: CredentialKind = 'stored_token';
  private readonly logger = new Logger(XAdapter.name);

  private readonly API_BASE = 'https://api.twitter.com/2';
  private readonly TOKEN_URL = 'https://api.x.com/2/oauth2/token';

  // ─── Interface implementation ──────────────────────────────────────────────

  async validateConnection(connection: AdapterConnection): Promise<ConnectionHealth> {
    try {
      const res = await fetch(`${this.API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
      return healthFromStatus(res.status, 'X', res.headers.get('retry-after'));
    } catch (err) {
      const health = healthFromFetchError(err, 'X');
      this.logger.warn(`X connection check failed (transient): ${!health.ok ? health.detail : ''}`);
      return health;
    }
  }

  /**
   * OAuth 2.0 refresh grant. Access tokens last 2 h; the refresh token comes
   * with `offline.access` and may rotate, so the caller persists both.
   * Client auth is Basic client_id:client_secret, as in the code exchange
   * (social-oauth.service.ts xCallback).
   */
  async refreshToken(connection: AdapterConnection): Promise<RefreshResult> {
    const clientId = process.env.TWITTER_CLIENT_ID?.trim();
    const clientSecret = process.env.TWITTER_CLIENT_SECRET?.trim();
    if (!clientId || !clientSecret) {
      // Our configuration, not the user's token: do not mark the account expired.
      return { ok: false, reason: 'transient', detail: 'X client credentials are not configured on the API.' };
    }
    if (!connection.refreshToken) {
      return { ok: false, reason: 'expired', detail: 'X connection has no refresh token. Reconnect the account.' };
    }

    try {
      const res = await fetch(this.TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: connection.refreshToken,
          client_id: clientId,
        }).toString(),
      });

      if (res.status === 400 || res.status === 401) {
        const body = (await res.text()).slice(0, 200);
        return { ok: false, reason: 'expired', detail: `X refused the refresh token (${res.status}): ${body}` };
      }
      if (!res.ok) {
        return { ok: false, reason: 'transient', detail: `X token endpoint returned ${res.status}.` };
      }

      const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!data.access_token) {
        return { ok: false, reason: 'transient', detail: 'X token endpoint returned no access_token.' };
      }
      return {
        ok: true,
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : undefined,
      };
    } catch (err) {
      return { ok: false, reason: 'transient', detail: `X token endpoint unreachable: ${describeFetchError(err)}` };
    }
  }

  validatePayload(payload: PublishPayload): ValidationResult {
    return validateX(payload);
  }

  async publish(
    connection: AdapterConnection,
    payload: PublishPayload,
  ): Promise<PublishResult> {
    try {
      // Append hashtags if provided
      const hashtags = (payload.hashtags ?? []).map((t) => `#${t}`).join(' ');
      const tweetText = hashtags ? `${payload.body} ${hashtags}`.trim() : payload.body;

      const body: Record<string, unknown> = { text: tweetText };

      // Attach reply-to URL as a quote tweet? Not in MVP. Just append URL to text.
      if (payload.linkUrl) {
        body.text = `${tweetText}\n${payload.linkUrl}`;
      }

      const res = await fetch(`${this.API_BASE}/tweets`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errBody = await res.text();
        return failedPublishResult(
          res.status,
          this.normalizeError({ status: res.status, body: errBody }),
          res.headers.get('retry-after'),
        );
      }

      const data = (await res.json()) as { data?: { id?: string } };
      const tweetId = data.data?.id ?? '';

      // X tweet URL format: https://twitter.com/i/web/status/{id}
      const externalPostUrl = tweetId
        ? `https://twitter.com/i/web/status/${tweetId}`
        : undefined;

      return { success: true, externalPostId: tweetId, externalPostUrl };
    } catch (err) {
      return failedPublishFromError(err, 'X');
    }
  }

  normalizeError(raw: unknown): string {
    if (raw instanceof Error) return raw.message;
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.body === 'string') return `X API ${obj.status}: ${obj.body}`;
      return JSON.stringify(obj);
    }
    return String(raw);
  }
}
