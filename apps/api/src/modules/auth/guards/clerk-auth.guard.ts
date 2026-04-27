import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyToken } from '@clerk/backend';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class ClerkAuthGuard implements CanActivate {
  private readonly logger = new Logger(ClerkAuthGuard.name);

  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY,
      });

      // Standardize the auth contract: request.user will have `id` and optionally `workspaceId`
      request.user = {
        id: payload.sub,
        // Depending on your setup, you might extract workspace info from the payload or from DB later.
        // For now, identity is just the user id.
      };

      return true;
    } catch (err) {
      this.logger.error(`Clerk JWT verification failed: ${(err as Error).message}`);
      throw new UnauthorizedException('Invalid or expired authentication token');
    }
  }

  private extractTokenFromHeader(request: any): string | undefined {
    // Standard Authorization header: "Bearer <token>"
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7);
    }
    
    // Fallback: check x-user-id header if we were using that temporarily (optional step for migration)
    return undefined;
  }
}
