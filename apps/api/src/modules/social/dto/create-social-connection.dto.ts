/**
 * create-social-connection.dto.ts
 *
 * Plain DTO interfaces for social connection CRUD endpoints.
 * Uses no external validation decorators — validation is done at service level.
 *
 * IMPORTANT: accessToken and refreshToken are write-only.
 * They must never appear in any response body or log.
 */

import type { SocialPlatform } from '@prisma/client';

/** Platform keys come from the Prisma enum — no local copy of the list. */
export type SocialPlatformDto = SocialPlatform;

export interface CreateSocialConnectionDto {
  workspaceId: string;
  platform: SocialPlatformDto;
  accountName: string;
  /** Handle, page-id, or LinkedIn person/org URN */
  accountIdentifier: string;
  /**
   * Raw OAuth access token — encrypted and stored by the service.
   * Write-only: never returned in responses. Absent only for platforms whose
   * credential lives in env (Telegram's one Contivo bot).
   */
  accessToken?: string;
  refreshToken?: string;
  /** Token expiry time as provided by the platform. */
  tokenExpiresAt?: Date;
  scopes?: string[];
  isDefault?: boolean;
  /** Defaults to 'oauth2' in the schema. Telegram: 'telegram_bot'. */
  authProvider?: string;
  /** Non-secret per-connection settings (SocialConnection.metaJson). Never a secret. */
  meta?: Record<string, unknown>;
}

export interface UpdateSocialConnectionDto {
  isDefault?: boolean;
  accountName?: string;
}
