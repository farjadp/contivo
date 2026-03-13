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
import { SocialPlatform } from '@contivo/types';
import {
  SocialAdapter,
  AdapterConnection,
  PublishPayload,
  PublishResult,
  ValidationResult,
} from './social-adapter.interface';
import { validateX } from '../validators/platform-validator';

@Injectable()
export class XAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'X';
  private readonly logger = new Logger(XAdapter.name);

  private readonly API_BASE = 'https://api.twitter.com/2';

  // ─── Interface implementation ──────────────────────────────────────────────

  async validateConnection(connection: AdapterConnection): Promise<boolean> {
    try {
      const res = await fetch(`${this.API_BASE}/users/me`, {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(`X connection validation failed: ${this.normalizeError(err)}`);
      return false;
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
        return {
          success: false,
          error: this.normalizeError({ status: res.status, body: errBody }),
        };
      }

      const data = (await res.json()) as { data?: { id?: string } };
      const tweetId = data.data?.id ?? '';

      // X tweet URL format: https://twitter.com/i/web/status/{id}
      const externalPostUrl = tweetId
        ? `https://twitter.com/i/web/status/${tweetId}`
        : undefined;

      return { success: true, externalPostId: tweetId, externalPostUrl };
    } catch (err) {
      return { success: false, error: this.normalizeError(err) };
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
