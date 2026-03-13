/**
 * linkedin.adapter.ts
 *
 * LinkedIn UGC Posts API adapter.
 *
 * MVP scope: text post + optional link.
 * Image support deferred to Phase 2.
 *
 * API reference: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 * Auth: OAuth 2.0 — w_member_social scope required.
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
import { validateLinkedIn } from '../validators/platform-validator';

@Injectable()
export class LinkedInAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'LINKEDIN';
  private readonly logger = new Logger(LinkedInAdapter.name);

  private readonly API_BASE = 'https://api.linkedin.com/v2';

  // ─── Interface implementation ──────────────────────────────────────────────

  async validateConnection(connection: AdapterConnection): Promise<boolean> {
    try {
      const res = await fetch(`${this.API_BASE}/userinfo`, {
        headers: { Authorization: `Bearer ${connection.accessToken}` },
      });
      return res.ok;
    } catch (err) {
      this.logger.warn(`LinkedIn connection validation failed: ${this.normalizeError(err)}`);
      return false;
    }
  }

  validatePayload(payload: PublishPayload): ValidationResult {
    return validateLinkedIn(payload);
  }

  async publish(
    connection: AdapterConnection,
    payload: PublishPayload,
  ): Promise<PublishResult> {
    try {
      // Build the UGC post body per LinkedIn API spec
      const ugcBody = this.buildUgcPost(connection.accountIdentifier, payload);

      const res = await fetch(`${this.API_BASE}/ugcPosts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify(ugcBody),
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

      // LinkedIn post URL: https://www.linkedin.com/feed/update/{urn}
      const externalPostUrl = postId
        ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postId)}`
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
      if (typeof obj.body === 'string') return `LinkedIn API ${obj.status}: ${obj.body}`;
      return JSON.stringify(obj);
    }
    return String(raw);
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  /**
   * Builds the LinkedIn UGC Post payload.
   * authorUrn format: urn:li:person:{personId} or urn:li:organization:{orgId}
   */
  private buildUgcPost(authorIdentifier: string, payload: PublishPayload): object {
    // Construct the full author URN if not already in URN format
    const author = authorIdentifier.startsWith('urn:')
      ? authorIdentifier
      : `urn:li:person:${authorIdentifier}`;

    // Build text body with optional hashtags appended
    const hashtags = (payload.hashtags ?? []).map((t) => `#${t}`).join(' ');
    const fullBody = hashtags ? `${payload.body}\n\n${hashtags}` : payload.body;

    if (payload.linkUrl) {
      // Article / link post
      return {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: fullBody },
            shareMediaCategory: 'ARTICLE',
            media: [
              {
                status: 'READY',
                originalUrl: payload.linkUrl,
              },
            ],
          },
        },
        visibility: {
          'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
        },
      };
    }

    // Plain text post
    return {
      author,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: fullBody },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
      },
    };
  }
}
