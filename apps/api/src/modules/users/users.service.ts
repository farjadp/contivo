import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';

export type PublicUser = Pick<
  User,
  'id' | 'email' | 'name' | 'avatarUrl' | 'plan' | 'role' | 'createdAt'
>;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the user behind an authenticated request.
   *
   * `SessionAuthGuard` supplies the local `users.id`; the older Clerk path
   * supplied a `clerkId`. Accepting either keeps any legacy record reachable.
   */
  async findByAuthId(authId: string): Promise<PublicUser | null> {
    return this.prisma.user.findFirst({
      where: { OR: [{ id: authId }, { clerkId: authId }] },
      // Explicit select: the previous version returned the whole row, so
      // GET /users/me handed the caller the account's bcrypt passwordHash.
      select: {
        id: true,
        email: true,
        name: true,
        avatarUrl: true,
        plan: true,
        role: true,
        createdAt: true,
      },
    });
  }
}
