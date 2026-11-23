import { execSync } from 'node:child_process';

import createNextIntlPlugin from 'next-intl/plugin';
import type { NextConfig } from 'next';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Commit stamp for bug reports. Empty when the build host has no .git (an uploaded tree);
 * lib/bug-report/app-version.ts then falls back to the Railway variables.
 */
function commitSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return '';
  }
}

const nextConfig: NextConfig = {
  env: { APP_COMMIT_SHA: commitSha() },
  transpilePackages: ['@contivo/types'],
  typedRoutes: true,
  eslint: {
    // Lint is enforced by `pnpm lint` in CI, not by the build.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Was `true`, which shipped type errors straight to production — the
    // failure mode this codebase keeps hitting is "looked fine, wasn't".
    // `pnpm typecheck` is green across all five packages, so this can stay off.
    ignoreBuildErrors: false,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'avatars.githubusercontent.com',
      },
    ],
  },
};

export default withNextIntl(nextConfig);
