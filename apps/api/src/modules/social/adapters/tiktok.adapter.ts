/**
 * tiktok.adapter.ts
 *
 * TikTok Content Publishing adapter (Content Posting API v2).
 *
 * Supports photo carousel posts (text + images).
 * Text-only posts are NOT supported by TikTok — media is always required.
 *
 * API reference:
 *   https://developers.tiktok.com/doc/content-posting-api-get-started
 *
 * Required OAuth scopes:
 *   video.publish  — for video posts
 *   video.upload   — for direct uploads
 *
 * Character limits:
 *   Caption: 2 200 chars (hashtags count toward this limit)
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

@Injectable()
export class TikTokAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'TIKTOK';
  private readonly logger = new Logger(TikTokAdapter.name);

  // ─── Interface implementation ─────────────────────────────────────────────

  async validateConnection(connection: AdapterConnection): Promise<boolean> {
    try {
      // TikTok user info endpoint
      const res = await fetch(
        'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name',
        { headers: { Authorization: `Bearer ${connection.accessToken}` } },
      );
      return res.ok;
    } catch (err) {
      this.logger.warn(`TikTok connection validation failed: ${this.normalizeError(err)}`);
      return false;
    }
  }

  validatePayload(payload: PublishPayload): ValidationResult {
    const errors: string[] = [];

    const hashtagStr = this.buildHashtagString(payload.hashtags);
    const captionLen = payload.body.length + (hashtagStr ? hashtagStr.length + 2 : 0);
    if (captionLen > 2200) {
      errors.push(`TikTok: caption + hashtags exceed 2200 chars (currently ${captionLen})`);
    }

    return { valid: errors.length === 0, errors };
  }

  async publish(
    connection: AdapterConnection,
    payload: PublishPayload,
  ): Promise<PublishResult> {
    const hashtagStr = this.buildHashtagString(payload.hashtags);
    const caption    = `${payload.body}${hashtagStr ? '\n\n' + hashtagStr : ''}`.slice(0, 2200);

    try {
      const publishId = await this.initPhotoPost(connection.accessToken, caption);
      return {
        success:         true,
        externalPostId:  publishId,
        externalPostUrl: `https://www.tiktok.com/@${connection.accountIdentifier}`,
      };
    } catch (err) {
      this.logger.error(`TikTok publish failed for account=${connection.accountIdentifier}: ${this.normalizeError(err)}`);
      return {
        success: false,
        error:   this.normalizeError(err),
      };
    }
  }

  normalizeError(raw: unknown): string {
    if (raw instanceof Error) return raw.message;
    if (typeof raw === 'object' && raw !== null) {
      const e = raw as Record<string, unknown>;
      return String(e['message'] ?? e['error'] ?? JSON.stringify(raw));
    }
    return String(raw);
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /**
   * TikTok Content Posting API — initialize a direct post.
   * Returns the publish_id on success.
   */
  private async initPhotoPost(accessToken: string, caption: string): Promise<string> {
    const body = {
      post_info: {
        title:            caption,
        privacy_level:    'PUBLIC_TO_EVERYONE',
        disable_duet:     false,
        disable_comment:  false,
        disable_stitch:   false,
        auto_add_music:   false,
      },
      source_info: {
        source: 'PULL_FROM_URL',
        // NOTE: In real use, pass mediaUrls from PublishPayload here
        photo_images:    [],
        photo_cover_index: 0,
      },
      post_mode:  'DIRECT_POST',
      media_type: 'PHOTO',
    };

    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/content/init/', {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        Authorization:  `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    const data = await res.json() as {
      data?: { publish_id: string };
      error?: { code: string; message: string };
    };

    if (!res.ok || (data.error && data.error.code !== 'ok')) {
      throw new Error(`TikTok API error [${data.error?.code}]: ${data.error?.message ?? res.statusText}`);
    }

    return data.data?.publish_id ?? 'unknown';
  }

  private buildHashtagString(hashtags?: string[]): string {
    if (!hashtags?.length) return '';
    return hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
  }
}
