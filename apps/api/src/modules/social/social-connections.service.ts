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
 *   - Tokens are XOR-encrypted with SOCIAL_TOKEN_SECRET from env before storage.
 *   - Tokens are decrypted only when an adapter needs them to publish.
 *   - No token is ever returned in a response or written to logs.
 *
 * Production upgrade path:
 *   Replace encrypt/decrypt helpers with calls to a secret manager
 *   (AWS Secrets Manager, GCP Secret Manager, Vault) using the stored ref key.
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  CreateSocialConnectionDto,
  UpdateSocialConnectionDto,
} from './dto/create-social-connection.dto';

@Injectable()
export class SocialConnectionsService {
  private readonly logger = new Logger(SocialConnectionsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  /** Creates and persists a new connection with encrypted token refs. */
  async create(dto: CreateSocialConnectionDto, userId?: string) {
    if (userId) await this.validateWorkspaceAccess(dto.workspaceId, userId);

    // If this connection is set as default, unset all others for the platform
    if (dto.isDefault) {
      await this.clearDefaultForPlatform(dto.workspaceId, dto.platform as any);
    }

    const encryptedAccessTokenRef  = this.encryptToken(dto.accessToken);
    const encryptedRefreshTokenRef = dto.refreshToken
      ? this.encryptToken(dto.refreshToken)
      : null;

    const connection = await this.prisma.socialConnection.create({
      data: {
        workspaceId:              dto.workspaceId,
        platform:                 dto.platform as any,
        accountName:              dto.accountName,
        accountIdentifier:        dto.accountIdentifier,
        encryptedAccessTokenRef,
        encryptedRefreshTokenRef,
        scopesJson:               dto.scopes ?? [],
        status:                   'CONNECTED',
        isDefault:                dto.isDefault ?? false,
        ...(dto.tokenExpiresAt && { tokenExpiresAt: dto.tokenExpiresAt }),
      },
      select: this.safeSelect(),
    });

    this.logger.log(
      `Social connection created: workspace=${dto.workspaceId} platform=${dto.platform} account=${dto.accountName}`,
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
        await this.clearDefaultForPlatform(workspaceId, conn.platform as any);
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
    await this.findOrThrow(id, workspaceId);

    await this.prisma.socialConnection.update({
      where: { id },
      data: {
        status: 'REVOKED' as any,
        encryptedAccessTokenRef:  null,
        encryptedRefreshTokenRef: null,
      },
    });

    this.logger.log(`Social connection disconnected: id=${id} workspace=${workspaceId}`);
  }

  /** Marks connection as PENDING_REAUTH so the front-end can trigger OAuth again. */
  async markForReauth(id: string, workspaceId: string, userId: string) {
    await this.validateWorkspaceAccess(workspaceId, userId);
    await this.findOrThrow(id, workspaceId);
    return this.prisma.socialConnection.update({
      where: { id },
      data: { status: 'PENDING_REAUTH' as any },
      select: this.safeSelect(),
    });
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

  private async clearDefaultForPlatform(workspaceId: string, platform: any) {
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

  // ─── Token encryption (MVP: XOR + base64) ─────────────────────────────────
  // Replace with proper KMS / Vault calls in production.

  public encryptToken(token: string): string {
    const secret = process.env.SOCIAL_TOKEN_SECRET ?? 'contivo-dev-secret-key-change-in-prod';
    const keyBytes = Buffer.from(secret, 'utf8');
    const tokenBytes = Buffer.from(token, 'utf8');
    const out = Buffer.alloc(tokenBytes.length);
    for (let i = 0; i < tokenBytes.length; i++) {
      out[i] = tokenBytes[i] ^ keyBytes[i % keyBytes.length];
    }
    return out.toString('base64');
  }

  public decryptToken(ref: string): string {
    // XOR encryption is symmetric — decrypt == encrypt
    return this.encryptToken(Buffer.from(ref, 'base64').toString('utf8'));
  }
}
