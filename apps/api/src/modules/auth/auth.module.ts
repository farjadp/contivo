import { Module } from '@nestjs/common';

/**
 * AuthModule
 *
 * Responsibilities:
 *   - Validate Clerk JWT tokens on incoming requests via ClerkAuthGuard
 *   - Expose @CurrentUser() decorator that injects authenticated user context
 *   - Expose @Public() decorator to mark routes as unauthenticated
 *
 * This module does NOT implement its own session storage.
 * Clerk is the sole source of truth for identity.
 *
 * TODO (when adding guards):
 *   1. Install @clerk/backend: pnpm add @clerk/backend
 *   2. Create ClerkAuthGuard that calls verifyToken() from @clerk/backend
 *   3. Register as global guard in AppModule using APP_GUARD
 */
@Module({})
export class AuthModule {}
