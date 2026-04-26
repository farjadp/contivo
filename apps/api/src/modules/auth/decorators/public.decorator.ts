import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * @Public()
 * 
 * Marks a specific route or class as public, bypassing the global ClerkAuthGuard.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
