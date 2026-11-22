/**
 * social-connections.service.ts
 *
 * Manages the lifecycle of social media account connections per workspace:
 *   - Create (save OAuth tokens encrypted)
 *   - List
 *   - Update (set default, rename)
 *   - Delete (disconnect)
 *   - Reconnect trigger
 *   - Status sync
 *
 * SECURITY:
 *   - Tokens are encrypted with AES-256-GCM keyed from SOCIAL_TOKEN_SECRET
 *     (see token-crypto.ts). The API refuses to start without that variable.
 *   - Tokens are decrypted only when an adapter needs them to publish.
 *   - No token is ever returned in a response or written to logs.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import type { SocialConnectionStatus, SocialPlatform } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

import {
  CreateSocialConnectionDto,
  UpdateSocialConnectionDto,
} from './dto/create-social-connection.dto';
import { isOAuthPlatform } from './platforms';
import * as tokenCrypto from './token-crypto';

/** What the web needs to restart a connect flow for a connection. */
export interface ReconnectInstruction {
  /** Lower-case platform key, as getSocialConnectUrl() expects. */
  platform: string;
  /** `oauth`: call getSocialConnectUrl(platform, workspaceId) and navigate. */
  flow: 'oauth' | 'unsupported';
}

@Injectable()
export class SocialConnectionsService {
  private readonly logger = new Logger(SocialConnectionsService.name);

  constructor(private readonly prisma: PrismaService) {
    // Fail at boot rather than on the first publish: without the secret no
    // stored token can be read and no new one can be written.
    tokenCrypto.getSocialTokenSecret();
  }

  // ─── Public methods ────────────────────────────────────────────────────────

  /** Lists all social connections for a workspace — tokens excluded. */
  async list(workspaceId: string, userId: string) {
    await this.validateWorkspaceAccess(workspaceId, userId);
    return this.prisma.socialConnection.findMany({
      where: { workspaceId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: this.safeSelect(),
    });
  }

  /**
   * Saves a connection with encrypted token refs.
   *
   * Upserts on (workspaceId, platform, accountIdentifier): reconnecting the
   * same account updates its row (same id, so publish history stays attached)
   * instead of leaving the old one behind. Done in code, not with a unique
   * index, until existing duplicates have been checked and merged.
   */
  async create(dto: CreateSocialConnectionDto, userId?: string) {
    if (userId) await this.validateWorkspaceAccess(dto.workspaceId, userId);

    // If this connection is set as default, unset all others for the platform
    if (dto.isDefault) {
      await this.clearDefaultForPlatform(dto.workspaceId, dto.platform);
    }

    const encryptedAccessTokenRef  = this.encryptToken(dto.accessToken);
    const encryptedRefreshTokenRef = dto.refreshToken
      ? this.encryptToken(dto.refreshToken)
      : null;

    const existing = await this.prisma.socialConnection.findFirst({
      where: {
        workspaceId:       dto.workspaceId,
        platform:          dto.platform,
        accountIdentifier: dto.accountIdentifier,
      },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    const fields = {
      accountName:              dto.accountName,
      encryptedAccessTokenRef,
      // A reconnect without a refresh token / expiry must not keep stale ones.
      encryptedRefreshTokenRef,
      tokenExpiresAt:           dto.tokenExpiresAt ?? null,
      scopesJson:               dto.scopes ?? [],
      status:                   'CONNECTED' as const,
      isDefault:                dto.isDefault ?? false,
      lastSyncAt:               new Date(),
    };

    const connection = existing
      ? await this.prisma.socialConnection.update({
          where: { id: existing.id },
          data: fields,
          select: this.safeSelect(),
        })
      : await this.prisma.socialConnection.create({
          data: {
            workspaceId:       dto.workspaceId,
            platform:          dto.platform,
            accountIdentifier: dto.accountIdentifier,
            ...fields,
          },
          select: this.safeSelect(),
        });

    this.logger.log(
      `Social connection ${existing ? 'reconnected' : 'created'}: workspace=${dto.workspaceId} platform=${dto.platform} account=${dto.accountName}`,
    );

    return connection;
  }

  /** Updates mutable fields on a connection (default flag, display name). */
  async update(id: string, workspaceId: string, dto: UpdateSocialConnectionDto, userId: string) {
    await this.validateWorkspaceAccess(workspaceId, userId);
    await this.findOrThrow(id, workspaceId);

    if (dto.isDefault) {
      const conn = await this.prisma.socialConnection.findUnique({ where: { id } });
      if (conn) {
        await this.clearDefaultForPlatform(workspaceId, conn.platform);
      }
    }

    return this.prisma.socialConnection.update({
      where: { id },
      data: {
        ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
        ...(dto.accountName !== undefined && { accountName: dto.accountName }),
      },
      select: this.safeSelect(),
    });
  }

  /** Soft-disconnects a connection by marking status = REVOKED and clearing tokens. */
  async disconnect(id: string, workspaceId: string, userId: string) {
    await this.validateWorkspaceAccess(workspaceId, userId);
    const { isDefault: wasDefault, platform } = await this.findOrThrow(id, workspaceId);

    // A REVOKED row must not stay the default: the scheduler only publishes
    // through a CONNECTED default, so the platform would silently stop.
    await this.prisma.socialConnection.update({
      where: { id },
      data: {
        status: 'REVOKED',
        isDefault: false,
        encryptedAccessTokenRef:  null,
        encryptedRefreshTokenRef: null,
      },
    });

    if (wasDefault) await this.promoteOldestConnected(workspaceId, platform);

    this.logger.log(`Social connection disconnected: id=${id} workspace=${workspaceId}`);
  }

  /**
   * Starts a reconnect. Returns the connection and what the web must do next:
   * for `flow: 'oauth'`, call getSocialConnectUrl(reconnect.platform,
   * workspaceId) and navigate there; the OAuth callback upserts this row back
   * to CONNECTED.
   *
   * A CONNECTED row is left CONNECTED: if the user abandons the OAuth page, a
   * working account must not stop publishing. Broken rows move to
   * PENDING_REAUTH so the UI can show "reconnect in progress".
   */
  async markForReauth(id: string, workspaceId: string, userId: string) {
    await this.validateWorkspaceAccess(workspaceId, userId);
    const conn = await this.findOrThrow(id, workspaceId);

    const connection = conn.status === 'CONNECTED'
      ? await this.prisma.socialConnection.findUnique({ where: { id }, select: this.safeSelect() })
      : await this.prisma.socialConnection.update({
          where: { id },
          data: { status: 'PENDING_REAUTH' },
          select: this.safeSelect(),
        });

    const platform = String(conn.platform).toLowerCase();
    const reconnect: ReconnectInstruction = {
      platform,
      flow: isOAuthPlatform(platform) ? 'oauth' : 'unsupported',
    };
    return { connection, reconnect };
  }

  /**
   * Records that a connection can no longer publish (EXPIRED / REVOKED).
   * Only moves a CONNECTED row, so a more specific earlier status survives.
   * Never throws: a failed status write must not mask the publish failure.
   */
  async markUnusable(id: string, status: Extract<SocialConnectionStatus, 'EXPIRED' | 'REVOKED'>, reason: string) {
    try {
      const { count } = await this.prisma.socialConnection.updateMany({
        where: { id, status: 'CONNECTED' },
        data:  { status },
      });
      if (count > 0) this.logger.warn(`Marked connection ${id} ${status}: ${reason}`);
    } catch (err) {
      this.logger.error(`Could not mark connection ${id} ${status}: ${(err as Error).message}`);
    }
  }

  /**
   * Decrypts and returns the access token for a specific connection.
   * FOR INTERNAL USE ONLY — never call from a controller or return in a response.
   */
  async getDecryptedTokens(id: string): Promise<{
    accessToken: string | null;
    refreshToken: string | null;
  }> {
    const conn = await this.prisma.socialConnection.findUnique({
      where: { id },
      select: {
        encryptedAccessTokenRef: true,
        encryptedRefreshTokenRef: true,
      },
    });
    if (!conn) throw new NotFoundException(`Connection ${id} not found`);

    return {
      accessToken:  conn.encryptedAccessTokenRef  ? this.decryptToken(conn.encryptedAccessTokenRef)  : null,
      refreshToken: conn.encryptedRefreshTokenRef ? this.decryptToken(conn.encryptedRefreshTokenRef) : null,
    };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  public async validateWorkspaceAccess(workspaceId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ clerkId: userId }, { id: userId }] },
    });

    if (!user) throw new ForbiddenException('User not found in system.');
    
    // Admins have global access and bypass tenancy checks
    if (user.role === 'ADMIN') {
      return;
    }

    const workspace = await this.prisma.workspace.findFirst({
      where: { id: workspaceId, userId: user.id },
    });

    if (!workspace) {
      throw new ForbiddenException(`You do not have access to workspace ${workspaceId}.`);
    }
  }

  private async findOrThrow(id: string, workspaceId: string) {
    const conn = await this.prisma.socialConnection.findFirst({
      where: { id, workspaceId },
    });
    if (!conn) throw new NotFoundException(`Social connection ${id} not found.`);
    return conn;
  }

  /**
   * After the default is disconnected: the oldest CONNECTED account of the
   * same platform becomes default (oldest = the one the user has relied on
   * longest; a deterministic choice the user can change with Make default).
   * Does nothing when another default already exists or none is connected.
   */
  private async promoteOldestConnected(workspaceId: string, platform: SocialPlatform) {
    const hasDefault = await this.prisma.socialConnection.findFirst({
      where: { workspaceId, platform, status: 'CONNECTED', isDefault: true },
      select: { id: true },
    });
    if (hasDefault) return;
    const next = await this.prisma.socialConnection.findFirst({
      where: { workspaceId, platform, status: 'CONNECTED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!next) return;
    await this.prisma.socialConnection.update({ where: { id: next.id }, data: { isDefault: true } });
    this.logger.log(`Default ${platform} connection moved to ${next.id} after a disconnect in workspace=${workspaceId}`);
  }

  private async clearDefaultForPlatform(workspaceId: string, platform: SocialPlatform) {
    await this.prisma.socialConnection.updateMany({
      where: { workspaceId, platform, isDefault: true },
      data: { isDefault: false },
    });
  }

  /**
   * Returns a Prisma select map that excludes sensitive token fields.
   * Always use this in public-facing queries.
   */
  private safeSelect() {
    return {
      id:               true,
      workspaceId:      true,
      platform:         true,
      accountName:      true,
      accountIdentifier:true,
      authProvider:     true,
      scopesJson:       true,
      status:           true,
      isDefault:        true,
      createdAt:        true,
      updatedAt:        true,
      lastSyncAt:       true,
      // encryptedAccessTokenRef  — EXCLUDED
      // encryptedRefreshTokenRef — EXCLUDED
    } as const;
  }

  // ─── Token encryption ─────────────────────────────────────────────────────
  // Writes v1 (AES-256-GCM); reads v1 and the legacy XOR format.

  public encryptToken(token: string): string {
    return tokenCrypto.encryptToken(token);
  }

  public decryptToken(ref: string): string {
    return tokenCrypto.decryptToken(ref);
  }
}
