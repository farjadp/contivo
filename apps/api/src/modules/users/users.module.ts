import { Module } from '@nestjs/common';

/**
 * UsersModule
 *
 * Responsibilities:
 *   - Sync user records from Clerk webhooks (user.created, user.updated)
 *   - Provide UserService for querying/updating user profiles
 *   - Surface user plan + credit balance for other modules
 *
 * TODO:
 *   1. Add POST /webhooks/clerk route handler (use svix to verify signature)
 *   2. Add GET /users/me endpoint
 *   3. Create UsersService with findByClerkId(), upsertFromClerk()
 */
@Module({})
export class UsersModule {}
