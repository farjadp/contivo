/**
 * create-social-connection.dto.ts
 *
 * Plain DTO interfaces for social connection CRUD endpoints.
 * Uses no external validation decorators — validation is done at service level.
 *
 * IMPORTANT: accessToken and refreshToken are write-only.
 * They must never appear in any response body or log.
 */

/** Supported social platforms for connection management. */
export type SocialPlatformDto = 'LINKEDIN' | 'X' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';

export interface CreateSocialConnectionDto {
  workspaceId: string;
  platform: SocialPlatformDto;
  accountName: string;
  /** Handle, page-id, or LinkedIn person/org URN */
  accountIdentifier: string;
  /**
   * Raw OAuth access token — encrypted and stored by the service.
   * Write-only: never returned in responses.
   */
  accessToken: string;
  refreshToken?: string;
  /** Token expiry time as provided by the platform. */
  tokenExpiresAt?: Date;
  scopes?: string[];
  isDefault?: boolean;
}

export interface UpdateSocialConnectionDto {
  isDefault?: boolean;
  accountName?: string;
}
