/**
 * create-publish-job.dto.ts
 *
 * Plain DTO interface for POST /social/publish-jobs.
 * Field validation is handled at the service layer (platform rules engine).
 */

import { SocialPlatformDto } from './create-social-connection.dto';

export interface CreatePublishJobDto {
  workspaceId: string;
  contentItemId?: string;
  socialConnectionId: string;
  platform: SocialPlatformDto;
  /** The content body to publish */
  body: string;
  /** Optional link URL (LinkedIn articles, Facebook link posts) */
  linkUrl?: string;
  /** Optional hashtags — without the # prefix */
  hashtags?: string[];
  /** ContentItem.topic, for channels that take a title. */
  title?: string;
  /** ContentItem.slug, when assigned. */
  slug?: string;
  format?: 'markdown';
  /** ISO-8601 UTC datetime string. Omit for immediate / manual publish. */
  scheduledAtUtc?: string;
  timezone?: string;
}
