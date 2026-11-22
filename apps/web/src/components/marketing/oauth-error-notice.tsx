/**
 * The explanation shown on /sign-in after a social sign-in was refused.
 *
 * Takes an already-whitelisted code (see `oauthErrorCode`), never a raw query
 * value, and renders only our own copy from `auth.oauthErrors`. A null code
 * renders nothing.
 */

import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import type { OAuthErrorCode } from '@/lib/oauth/errors';
import { oauthErrorCode } from '@/lib/oauth-error-code';

export function OAuthErrorNotice({ code: raw }: { code: OAuthErrorCode | null }) {
  const t = useTranslations('auth.oauthErrors');
  // Checked again here so the component is safe on its own: a value that
  // skipped the page's whitelist still prints nothing.
  const code = oauthErrorCode(raw);

  if (!code) return null;

  return (
    <p
      role="alert"
      data-oauth-error={code}
      className="mb-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] leading-relaxed text-red-700"
    >
      {t.rich(code, {
        contact: (chunks) => (
          <Link href="/contact" className="font-semibold underline underline-offset-4">
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
