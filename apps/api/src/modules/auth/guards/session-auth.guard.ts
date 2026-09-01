import { createHmac, timingSafeEqual } from 'crypto';

import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Verifies the web app's own session token.
 *
 * The previous guard only accepted Clerk tokens, but the product does not use
 * Clerk to sign users in — `apps/web/src/lib/auth.ts` mints an HS256 JWT and
 * stores it in an httpOnly cookie. The result was that every API route was
 * unreachable from the product: the browser had no Clerk token to send, so
 * calls came back 401 and the callers' catch blocks turned that into empty
 * lists and "something went wrong". Instant Content and the admin console's
 * social job controls were both dead for this reason.
 *
 * Callers are Next.js server actions, which mint a token from the session and
 * send it as `Authorization: Bearer <token>`. The signing secret and payload
 * shape must stay in sync with `apps/web/src/lib/auth.ts`.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  private readonly logger = new Logger(SessionAuthGuard.name);

  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const token = extractBearer(request);
    if (!token) {
      throw new UnauthorizedException('No authentication token provided');
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Falling back to a default here is how a public repo ends up with
      // forgeable ADMIN sessions. Refuse instead.
      this.logger.error('JWT_SECRET is not set — refusing to authenticate any request.');
      throw new UnauthorizedException('Server is not configured for authentication');
    }

    const payload = verifyHs256(token, secret);
    if (!payload) {
      throw new UnauthorizedException('Invalid or expired authentication token');
    }

    request.user = { id: payload.userId, role: payload.role, email: payload.email };
    return true;
  }
}

function extractBearer(request: any): string | undefined {
  const header = request.headers?.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim() || undefined;
  }
  return undefined;
}

type SessionClaims = { userId: string; email?: string; role?: string; exp?: number };

/** Verifies a compact HS256 JWS and returns its claims, or null if unusable. */
function verifyHs256(token: string, secret: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, signatureB64] = parts;

  let header: { alg?: string };
  let claims: SessionClaims;
  try {
    header = JSON.parse(Buffer.from(headerB64, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  // Pinning the algorithm keeps `alg: none` and RS256-confusion attacks out.
  if (header.alg !== 'HS256') return null;

  const expected = createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const provided = Buffer.from(signatureB64, 'base64url');
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  if (typeof claims.exp === 'number' && claims.exp * 1000 <= Date.now()) return null;
  if (!claims.userId || typeof claims.userId !== 'string') return null;

  return claims;
}
