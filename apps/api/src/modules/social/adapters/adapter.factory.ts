/**
 * adapter.factory.ts
 *
 * AdapterFactory — resolves and returns the correct SocialAdapter for a given
 * platform without any if/else chains in calling code.
 *
 * Add new adapters here as new platforms are onboarded.
 * All adapters are NestJS Injectable services registered in SocialModule.
 */

import { PLATFORM_KEYS } from '@contivo/types';
import { Injectable } from '@nestjs/common';
import type { SocialPlatform } from '@prisma/client';


import { FacebookAdapter } from './facebook.adapter';
import { InstagramAdapter } from './instagram.adapter';
import { LinkedInAdapter } from './linkedin.adapter';
import { SocialAdapter } from './social-adapter.interface';
import { TikTokAdapter } from './tiktok.adapter';
import { XAdapter } from './x.adapter';

/**
 * A known platform (in the enum) whose adapter is not built yet, e.g. TELEGRAM
 * or THREADS before their PRs land. A permanent failure, never a retry.
 */
export class UnsupportedPlatformError extends Error {
  constructor(readonly platform: string) {
    super(`${platform} publishing is not supported yet.`);
    this.name = 'UnsupportedPlatformError';
  }
}

@Injectable()
export class AdapterFactory {
  /** Map of platform → adapter instance, injected via NestJS DI. */
  private readonly adapters: Map<SocialPlatform, SocialAdapter>;

  constructor(
    private readonly linkedin:  LinkedInAdapter,
    private readonly x:         XAdapter,
    private readonly facebook:  FacebookAdapter,
    private readonly instagram: InstagramAdapter,
    private readonly tiktok:    TikTokAdapter,
  ) {
    this.adapters = new Map<SocialPlatform, SocialAdapter>([
      ['LINKEDIN',  this.linkedin],
      ['X',         this.x],
      ['FACEBOOK',  this.facebook],
      ['INSTAGRAM', this.instagram],
      ['TIKTOK',    this.tiktok],
    ]);
  }

  /** Whether an adapter exists for this platform. */
  isSupported(platform: string): boolean {
    return this.adapters.has(platform as SocialPlatform);
  }

  /**
   * Returns the adapter for the given platform.
   * Throws UnsupportedPlatformError for a known platform without an adapter,
   * and a plain Error for a value that is not a platform at all.
   */
  getAdapter(platform: string): SocialAdapter {
    const adapter = this.adapters.get(platform as SocialPlatform);
    if (adapter) return adapter;
    if ((PLATFORM_KEYS as readonly string[]).includes(platform)) {
      throw new UnsupportedPlatformError(platform);
    }
    throw new Error(`Unknown social platform "${platform}".`);
  }
}
