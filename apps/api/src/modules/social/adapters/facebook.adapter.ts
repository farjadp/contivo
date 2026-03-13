/**
 * facebook.adapter.ts
 *
 * Facebook Graph API adapter — Page Feed posts.
 *
 * MVP scope: text post + optional link on a connected Page.
 * Image support deferred to Phase 2.
 *
 * API reference: https://developers.facebook.com/docs/graph-api/reference/page/feed
 * Auth: OAuth 2.0 Page Access Token with pages_manage_posts scope.
 * The accountIdentifier for Facebook connections MUST be the Page ID.
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
import { validateFacebook } from '../validators/platform-validator';

@Injectable()
export class FacebookAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'FACEBOOK';
  private readonly logger = new Logger(FacebookAdapter.name);

  private readonly GRAPH_BASE = 'https://graph.facebook.com/v19.0';

  // ─── Interface implementation ──────────────────────────────────────────────

  async validateConnection(connection: AdapterConnection): Promise<boolean> {
    try {
      // Verify the page token by fetching page metadata
      const url = new URL(`${this.GRAPH_BASE}/${connection.accountIdentifier}`);
      url.searchParams.set('fields', 'id,name');
      url.searchParams.set('access_token', connection.accessToken);

      const res = await fetch(url.toString());
      return res.ok;
    } catch (err) {
      this.logger.warn(`Facebook connection validation failed: ${this.normalizeError(err)}`);
      return false;
    }
  }

  validatePayload(payload: PublishPayload): ValidationResult {
    return validateFacebook(payload);
  }

  async publish(
    connection: AdapterConnection,
    payload: PublishPayload,
  ): Promise<PublishResult> {
    const pageId = connection.accountIdentifier;

    try {
      // Append hashtags to message body
      const hashtags = (payload.hashtags ?? []).map((t) => `#${t}`).join(' ');
      const message = hashtags ? `${payload.body}\n\n${hashtags}` : payload.body;

      const feedUrl = `${this.GRAPH_BASE}/${pageId}/feed`;

      const formData = new URLSearchParams();
      formData.set('message', message);
      formData.set('access_token', connection.accessToken);
      if (payload.linkUrl) formData.set('link', payload.linkUrl);

      const res = await fetch(feedUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      if (!res.ok) {
        const errBody = await res.text();
        return {
          success: false,
          error: this.normalizeError({ status: res.status, body: errBody }),
        };
      }

      const data = (await res.json()) as { id?: string };
      const postId = data.id ?? '';

      // Facebook post URL format is not deterministic from ID alone — provide a
      // profile link as fallback.
      const externalPostUrl = postId
        ? `https://www.facebook.com/${pageId}/posts/${postId.split('_')[1] ?? postId}`
        : undefined;

      return { success: true, externalPostId: postId, externalPostUrl };
    } catch (err) {
      return { success: false, error: this.normalizeError(err) };
    }
  }

  normalizeError(raw: unknown): string {
    if (raw instanceof Error) return raw.message;
    if (typeof raw === 'object' && raw !== null) {
      const obj = raw as Record<string, unknown>;
      if (typeof obj.body === 'string') return `Facebook API ${obj.status}: ${obj.body}`;
      return JSON.stringify(obj);
    }
    return String(raw);
  }
}
