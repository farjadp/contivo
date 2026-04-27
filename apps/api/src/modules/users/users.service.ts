import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find a user by their Clerk ID.
   */
  async findByClerkId(clerkId: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { clerkId },
    });
  }

  /**
   * Idempotently create or update a user based on Clerk webhook payload.
   * Handles user.created and user.updated events.
   */
  async upsertFromClerk(payload: any): Promise<User> {
    const clerkId = payload.id;
    const emailAddresses = payload.email_addresses || [];
    const primaryEmailId = payload.primary_email_address_id;

    // Find the primary email
    let email = '';
    if (primaryEmailId) {
      const primaryEmailObj = emailAddresses.find((e: any) => e.id === primaryEmailId);
      if (primaryEmailObj) {
        email = primaryEmailObj.email_address;
      }
    }
    
    // Fallback if primary wasn't found but there is at least one email
    if (!email && emailAddresses.length > 0) {
      email = emailAddresses[0].email_address;
    }

    const firstName = payload.first_name || '';
    const lastName = payload.last_name || '';
    const name = [firstName, lastName].filter(Boolean).join(' ') || null;
    const avatarUrl = payload.image_url || null;

    if (!email) {
      this.logger.warn(`Clerk payload for user ${clerkId} did not contain an email address. Skipping sync.`);
      // We throw or return based on what we want. Usually we require an email.
      throw new Error(`User sync failed: No email provided for clerkId ${clerkId}`);
    }

    try {
      const user = await this.prisma.user.upsert({
        where: { clerkId },
        update: {
          email,
          name,
          avatarUrl,
        },
        create: {
          clerkId,
          email,
          name,
          avatarUrl,
        },
      });

      this.logger.log(`Successfully synced user ${user.id} from Clerk (${clerkId})`);
      return user;
    } catch (error) {
      this.logger.error(`Failed to upsert user ${clerkId}: ${(error as Error).message}`);
      throw error;
    }
  }
}
