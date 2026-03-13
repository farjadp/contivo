/**
 * adapter.factory.ts
 *
 * AdapterFactory — resolves and returns the correct SocialAdapter for a given
 * platform without any if/else chains in calling code.
 *
 * Add new adapters here as new platforms are onboarded.
 * All adapters are NestJS Injectable services registered in SocialModule.
 */

import { Injectable } from '@nestjs/common';
import { SocialAdapter } from './social-adapter.interface';
import { LinkedInAdapter } from './linkedin.adapter';
import { XAdapter } from './x.adapter';
import { FacebookAdapter } from './facebook.adapter';
import { InstagramAdapter } from './instagram.adapter';
import { TikTokAdapter } from './tiktok.adapter';

// Use a plain string key to avoid @contivo/types import before package is built
type PlatformKey = 'LINKEDIN' | 'X' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK';

@Injectable()
export class AdapterFactory {
  /** Map of platform → adapter instance, injected via NestJS DI. */
  private readonly adapters: Map<PlatformKey, SocialAdapter>;

  constructor(
    private readonly linkedin:  LinkedInAdapter,
    private readonly x:         XAdapter,
    private readonly facebook:  FacebookAdapter,
    private readonly instagram: InstagramAdapter,
    private readonly tiktok:    TikTokAdapter,
  ) {
    this.adapters = new Map<PlatformKey, SocialAdapter>([
      ['LINKEDIN',  this.linkedin],
      ['X',         this.x],
      ['FACEBOOK',  this.facebook],
      ['INSTAGRAM', this.instagram],
      ['TIKTOK',    this.tiktok],
    ]);
  }

  /**
   * Returns the adapter for the given platform.
   * Throws a descriptive error if the platform is unrecognised — prevents
   * silent no-ops if a new enum value is added without a matching adapter.
   */
  getAdapter(platform: string): SocialAdapter {
    const adapter = this.adapters.get(platform as PlatformKey);
    if (!adapter) {
      throw new Error(
        `No adapter registered for platform "${platform}". ` +
        `Register it in AdapterFactory and SocialModule.`,
      );
    }
    return adapter;
  }
}
