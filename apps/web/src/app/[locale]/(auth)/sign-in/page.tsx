'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { login } from '@/app/actions/auth';
import { AuthField, AuthShell, authAccent } from '@/components/marketing/auth-shell';
import { Link } from '@/i18n/navigation';

const initialState = { error: '' };

export default function SignInPage() {
  const t = useTranslations('auth.signIn');
  const [state, formAction, isPending] = useActionState(login as never, initialState);

  return (
    <AuthShell
      eyebrow={t('eyebrow')}
      title={t.rich('title', { accent: authAccent })}
      blurb={t('blurb')}
      footer={t.rich('footer', {
        link: (chunks) => (
          <Link
            href="/sign-up"
            className="font-semibold text-carbon underline decoration-carbon/30 underline-offset-4 transition-colors hover:decoration-brick"
          >
            {chunks}
          </Link>
        ),
      })}
    >
      <form action={formAction} className="space-y-8" noValidate>
        {state?.error && (
          <p role="alert" className="border-s-2 border-brick ps-4 text-[14px] text-brick-deep">
            {state.error}
          </p>
        )}

        <AuthField
          id="email"
          label={t('emailLabel')}
          type="email"
          autoComplete="email"
          placeholder={t('emailPlaceholder')}
        />
        <AuthField
          id="password"
          label={t('passwordLabel')}
          type="password"
          autoComplete="current-password"
          placeholder={t('passwordPlaceholder')}
        />

        <button
          type="submit"
          disabled={isPending}
          className="group w-full bg-carbon px-7 py-4 text-[14.5px] font-semibold text-paper-warm transition-colors duration-300 hover:bg-brick disabled:opacity-60"
        >
          {isPending ? t('submitting') : t('submit')}
          <span
            aria-hidden
            className="ms-3 inline-block transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180"
          >
            &rarr;
          </span>
        </button>
      </form>
    </AuthShell>
  );
}
