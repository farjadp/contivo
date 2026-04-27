/**
 * social-publish.controller.ts
 *
 * REST endpoints for managing social publish jobs.
 *
 * All routes are prefixed: /api/v1/social/publish-jobs
 *
 * Routes:
 *   POST   /                     Create and enqueue a new publish job
 *   GET    /                     List publish jobs for workspace (filterable by status)
 *   GET    /:id                  Get full job detail including audit logs
 *   POST   /:id/retry            Retry a failed job
 *   DELETE /:id                  Cancel a pending/scheduled job
 * Auth: Protected by global ClerkAuthGuard. User identity available via @CurrentUser().
 * NOTE: Publishing does NOT happen inside the HTTP response.
 *       Jobs are fire-and-forget (MVP) / BullMQ (production).
 *       Clients should poll GET /:id to observe status transitions.
 */

import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { SocialPublishService } from './social-publish.service';
import { CreatePublishJobDto } from './dto/create-publish-job.dto';

@Controller('social/publish-jobs')
export class SocialPublishController {
  constructor(private readonly service: SocialPublishService) {}

  // POST /social/publish-jobs
  @Post()
  async create(
    @Body() dto: CreatePublishJobDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const job = await this.service.createJob(dto, user.id);
    return { job };
  }

  // GET /social/publish-jobs?workspaceId=xxx&status=SCHEDULED
  @Get()
  async list(
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    return this.service.listJobs(workspaceId, user.id, {
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // GET /social/publish-jobs/:id?workspaceId=xxx
  @Get(':id')
  async getDetail(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    return this.service.getJobDetail(id, workspaceId, user.id);
  }

  // POST /social/publish-jobs/:id/retry?workspaceId=xxx
  @Post(':id/retry')
  async retry(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    const job = await this.service.retry(id, workspaceId, user.id);
    return { job };
  }

  // DELETE /social/publish-jobs/:id?workspaceId=xxx
  @Delete(':id')
  async cancel(
    @Param('id') id: string,
    @Query('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!workspaceId) throw new NotFoundException('workspaceId query param is required.');
    const job = await this.service.cancel(id, workspaceId, user.id);
    return { job };
  }
}
