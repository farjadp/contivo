/**
 * Which build is this? A chain that needs no hand-set env var:
 *  1. APP_COMMIT_SHA: stamped by next.config at build time (`git rev-parse`). Empty when the
 *     build host has no .git (a `railway up` upload may not include it).
 *  2. RAILWAY_GIT_COMMIT_SHA: set by Railway only for GitHub-triggered deploys.
 *  3. deploy:<first 8 of RAILWAY_DEPLOYMENT_ID>: set for every Railway deployment.
 */
export type VersionEnv = {
  APP_COMMIT_SHA?: string;
  RAILWAY_GIT_COMMIT_SHA?: string;
  RAILWAY_DEPLOYMENT_ID?: string;
};

const clean = (v: string | undefined): string => (v ?? '').trim();

export function resolveAppVersion(env: VersionEnv): string | null {
  const stamped = clean(env.APP_COMMIT_SHA);
  if (stamped) return stamped.slice(0, 7);
  const gitSha = clean(env.RAILWAY_GIT_COMMIT_SHA);
  if (gitSha) return gitSha.slice(0, 7);
  const deployment = clean(env.RAILWAY_DEPLOYMENT_ID);
  if (deployment) return `deploy:${deployment.slice(0, 8)}`;
  return null;
}
