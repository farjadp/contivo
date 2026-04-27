/**
 * social-connections.controller.ts
 *
 * REST endpoints for managing social media account connections.
 *
 * All routes are prefixed: /api/v1/social/connections
 *
 * Routes:
 *   GET    /                     List all connections for the workspace
 *   POST   /                     Save a new OAuth-connected account
 *   PATCH  /:id                  Update connection (default flag, display name)
 *   DELETE /:id                  Disconnect an account
 *   POST   /:id/reconnect        Mark connection as PENDING_REAUTH
 * Auth: Protected by global ClerkAuthGuard. User identity available via @CurrentUser().
 * SECURITY: No token fields are ever included in responses.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { SocialConnectionsService } from './social-connections.service';
import {
  CreateSocialConnectionDto,
  UpdateSocialConnectionDto,
} from './dto/create-social-connection.dto';

@Controller('social/connections')
export class SocialConnectionsController {
  constructor(private readonly service: SocialConnectionsService) {}

  // GET /social/connections?workspaceId=xxx
  @Get()
  async list(
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    const connections = await this.service.list(workspaceId, user.id);
    return { connections, total: connections.length };
  }

  // POST /social/connections
  @Post()
  async create(
    @Body() dto: CreateSocialConnectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const connection = await this.service.create(dto, user.id);
    return { connection };
  }

  // PATCH /social/connections/:id
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @Body() dto: UpdateSocialConnectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    const connection = await this.service.update(id, workspaceId, dto, user.id);
    return { connection };
  }

  // DELETE /social/connections/:id
  @Delete(':id')
  async disconnect(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    await this.service.disconnect(id, workspaceId, user.id);
    return { success: true };
  }

  // POST /social/connections/:id/reconnect
  @Post(':id/reconnect')
  async reconnect(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    const connection = await this.service.markForReauth(id, workspaceId, user.id);
    return { connection };
  }
}
