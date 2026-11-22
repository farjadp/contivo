import { normalizeIntakeSite } from '@/lib/intake-site';
import { enabledProviders, oauthStartHref } from '@/lib/oauth/providers';

import { SignUpForm } from './SignUpForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ cohort?: string | string[]; site?: string | string[] }>;
};

/**
 * Server wrapper: reads which providers are switched on (env) and passes the
 * invite cohort and typed site to each provider link, so a social sign-up
 * lands in the same place a password sign-up does.
 */
export default async function SignUpPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const query = await searchParams;
  const cohort = typeof query.cohort === 'string' ? query.cohort : '';
  const site = normalizeIntakeSite(query.site);
  const providers = enabledProviders().map((id) => ({
    id,
    href: oauthStartHref(id, { locale, cohort: cohort || undefined, site: site?.url }),
  }));

  return <SignUpForm providers={providers} cohort={cohort} site={site} />;
}
