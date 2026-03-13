/**
 * instagram.adapter.ts
 *
 * Instagram Business API adapter — Phase 2 STUB.
 *
 * Instagram requires a media asset (image or video) for every post.
 * The full implementation depends on a media pipeline (upload to blob storage,
 * then reference the URL in the Instagram Container API).
 *
 * Until the media pipeline is ready, this adapter rejects all publish attempts
 * with a clear, actionable error message.
 *
 * Phase 2 implementation steps:
 *   1. Upload image to Vercel Blob (or S3-compatible store)
 *   2. POST to /{ig-user-id}/media with image_url + caption
 *   3. POST to /{ig-user-id}/media_publish with creation_id
 *   4. Return media_id as externalPostId
 *
 * API reference: https://developers.facebook.com/docs/instagram-api/guides/content-publishing
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
import { validateInstagram } from '../validators/platform-validator';

const PHASE2_ERROR =
  'Instagram publishing is not yet available. ' +
  'It requires a media asset (image/video) and a media pipeline. ' +
  'This feature is scheduled for Phase 2.';

@Injectable()
export class InstagramAdapter implements SocialAdapter {
  readonly platform: SocialPlatform = 'INSTAGRAM';
  private readonly logger = new Logger(InstagramAdapter.name);

  async validateConnection(_connection: AdapterConnection): Promise<boolean> {
    this.logger.warn('Instagram adapter is a Phase 2 stub — validateConnection rejected.');
    return false;
  }

  validatePayload(payload: PublishPayload): ValidationResult {
    // Delegates to platform-validator which always returns invalid + reason
    return validateInstagram(payload);
  }

  async publish(
    _connection: AdapterConnection,
    _payload: PublishPayload,
  ): Promise<PublishResult> {
    this.logger.warn('Instagram publish attempted — Phase 2 stub, rejecting.');
    return { success: false, error: PHASE2_ERROR };
  }

  normalizeError(raw: unknown): string {
    if (raw instanceof Error) return raw.message;
    return String(raw);
  }
}
