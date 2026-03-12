import { Module } from '@nestjs/common';

/**
 * WorkspacesModule
 *
 * Responsibilities:
 *   - CRUD for Growth Engine workspaces (scoped to authenticated userId)
 *   - Workspace membership (future: invite team members)
 *   - Trigger crawl + analysis jobs on workspace creation
 *
 * TODO:
 *   1. Create WorkspacesController: POST /workspaces, GET /workspaces, GET /workspaces/:id
 *   2. Create WorkspacesService with create(), findAllForUser(), findOne()
 *   3. On create: enqueue website crawl job via JobsService
 */
@Module({})
export class WorkspacesModule {}
