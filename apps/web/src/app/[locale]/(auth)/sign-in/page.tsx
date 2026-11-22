import { enabledProviders, oauthStartHref } from '@/lib/oauth/providers';
import { oauthErrorCode } from '@/lib/oauth-error-code';

import { SignInForm } from './SignInForm';

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ error?: string | string[] }>;
};

/**
 * Server wrapper: reads which providers are switched on (env) and the
 * `?error=` code, and hands the form plain data. The env never reaches the
 * client bundle; the error value is whitelisted before it goes anywhere.
 */
export default async function SignInPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { error } = await searchParams;
  const providers = enabledProviders().map((id) => ({ id, href: oauthStartHref(id, { locale }) }));

  return <SignInForm providers={providers} errorCode={oauthErrorCode(error)} />;
}
