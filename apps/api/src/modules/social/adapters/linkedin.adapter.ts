/**
 * linkedin.adapter.ts
 *
 * LinkedIn UGC Posts API adapter.
 *
 * Scope: text post, optional link, optional single image.
 *
 * Images use LinkedIn's three-step asset flow: registerUpload to get an upload
 * URL and asset URN, PUT the bytes to that URL, then reference the URN in the
 * UGC post as shareMediaCategory IMAGE.
 *
 * API reference: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
 * Auth: OAuth 2.0 — w_member_social scope required.
 *
 * NOTE: Real token injection happens in SocialPublishJobsService before calling
 *       this adapter. Never log or expose the accessToken.
 */

import { SocialPlatform } from '@contivo/types';
import { Injectable, Logger } from '@nestjs/common';

import { validateLinkedIn } from '../validators/platform-validator';

import {
  SocialAdapter,
  AdapterConnection,
  PublishImage,
  PublishPayload,
  PublishResult,
  ValidationResult,
} from './social-adapter.interface';


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
      // Upload artwork first so the post can reference the asset URN. A failed
      // upload degrades to a text post rather than losing the post entirely.
      let assetUrn: string | undefined;
      if (payload.image) {
        assetUrn = await this.uploadImage(connection, payload.image);
        if (!assetUrn) {
          this.logger.warn('LinkedIn image upload failed; publishing as text only');
        }
      }

      // Build the UGC post body per LinkedIn API spec
      const ugcBody = this.buildUgcPost(connection.accountIdentifier, payload, assetUrn);

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

  /**
   * LinkedIn's three-step image flow. Returns the asset URN, or undefined if
   * any step fails — callers fall back to a text-only post.
   */
  private async uploadImage(
    connection: AdapterConnection,
    image: PublishImage,
  ): Promise<string | undefined> {
    const author = connection.accountIdentifier.startsWith('urn:')
      ? connection.accountIdentifier
      : `urn:li:person:${connection.accountIdentifier}`;

    try {
      // 1. Register the upload and receive a one-time upload URL + asset URN.
      const registerRes = await fetch(`${this.API_BASE}/assets?action=registerUpload`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': 'application/json',
          'X-Restli-Protocol-Version': '2.0.0',
        },
        body: JSON.stringify({
          registerUploadRequest: {
            owner: author,
            recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
            serviceRelationships: [
              {
                identifier: 'urn:li:userGeneratedContent',
                relationshipType: 'OWNER',
              },
            ],
          },
        }),
      });

      if (!registerRes.ok) {
        this.logger.warn(`registerUpload failed: ${registerRes.status} ${(await registerRes.text()).slice(0, 200)}`);
        return undefined;
      }

      const registered = (await registerRes.json()) as any;
      const uploadUrl =
        registered?.value?.uploadMechanism?.[
          'com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'
        ]?.uploadUrl;
      const asset = registered?.value?.asset;
      if (!uploadUrl || !asset) {
        this.logger.warn('registerUpload response missing uploadUrl or asset');
        return undefined;
      }

      // 2. PUT the raw bytes to the returned URL.
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${connection.accessToken}`,
          'Content-Type': image.mimeType || 'image/png',
        },
        body: new Uint8Array(image.data),
      });

      if (!uploadRes.ok) {
        this.logger.warn(`image upload failed: ${uploadRes.status}`);
        return undefined;
      }

      // 3. The asset URN is usable in the post immediately.
      return String(asset);
    } catch (err) {
      this.logger.warn(`LinkedIn image upload error: ${this.normalizeError(err)}`);
      return undefined;
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
  private buildUgcPost(
    authorIdentifier: string,
    payload: PublishPayload,
    assetUrn?: string,
  ): object {
    // Construct the full author URN if not already in URN format
    const author = authorIdentifier.startsWith('urn:')
      ? authorIdentifier
      : `urn:li:person:${authorIdentifier}`;

    // Build text body with optional hashtags appended
    const hashtags = (payload.hashtags ?? []).map((t) => `#${t}`).join(' ');
    const fullBody = hashtags ? `${payload.body}\n\n${hashtags}` : payload.body;

    if (assetUrn) {
      // Image post. LinkedIn requires the asset URN registered for this author.
      return {
        author,
        lifecycleState: 'PUBLISHED',
        specificContent: {
          'com.linkedin.ugc.ShareContent': {
            shareCommentary: { text: fullBody },
            shareMediaCategory: 'IMAGE',
            media: [
              {
                status: 'READY',
                media: assetUrn,
                ...(payload.image?.altText
                  ? { description: { text: payload.image.altText.slice(0, 200) } }
                  : {}),
              },
            ],
          },
        },
        visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
      };
    }

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
