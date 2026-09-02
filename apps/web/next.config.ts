import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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

export default nextConfig;
