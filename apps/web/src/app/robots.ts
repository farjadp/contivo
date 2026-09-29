import type { MetadataRoute } from 'next';

/**
 * Everything public is crawlable. The signed-in app is not: those routes only
 * redirect a crawler to sign-in, and the API has nothing to index.
 */
const PRIVATE = ['dashboard', 'growth', 'connections', 'instant', 'settings', 'onboarding', 'admin', 'billing'];

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.contivo.app').replace(/\/$/, '');
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/api/', ...PRIVATE.map((p) => `/*/${p}`)],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
