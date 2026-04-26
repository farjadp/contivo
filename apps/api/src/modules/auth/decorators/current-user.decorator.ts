import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthenticatedUser {
  id: string; // The Clerk User ID
  workspaceId?: string; // Optional workspace ID (handled by other logic if needed, but standardizing the interface)
}

/**
 * @CurrentUser()
 * 
 * Extracts the authenticated user's identity from the request object.
 * This ensures we have a standard contract across all endpoints.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest();
    // The ClerkAuthGuard will attach the verified token payload to request.user
    return request.user;
  },
);
