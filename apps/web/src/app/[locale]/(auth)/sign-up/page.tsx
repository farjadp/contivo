'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { register } from '@/app/actions/auth';
import { AuthField, AuthShell, authAccent } from '@/components/marketing/auth-shell';
import { Link } from '@/i18n/navigation';

const initialState = { error: '' };

export default function SignUpPage() {
  const t = useTranslations('auth.signUp');
  const [state, formAction, isPending] = useActionState(register as never, initialState);

  return (
    <AuthShell
      eyebrow={t('eyebrow')}
      title={t.rich('title', { accent: authAccent })}
      blurb={t('blurb')}
      footer={t.rich('footer', {
        link: (chunks) => (
          <Link
            href="/sign-in"
            className="font-semibold text-moss underline decoration-moss/30 underline-offset-4 transition-colors hover:decoration-saffron"
          >
            {chunks}
          </Link>
        ),
      })}
    >
      <form action={formAction} className="space-y-8" noValidate>
        {state?.error && (
          <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {state.error}
          </p>
        )}

        <AuthField
          id="name"
          label={t('nameLabel')}
          type="text"
          autoComplete="name"
          placeholder={t('namePlaceholder')}
        />
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
          autoComplete="new-password"
          placeholder={t('passwordPlaceholder')}
        />

        <button
          type="submit"
          disabled={isPending}
          className="group w-full bg-moss px-7 py-4 text-[14.5px] font-semibold text-chalk transition-colors duration-300 hover:bg-moss-700 disabled:opacity-60"
        >
          {isPending ? t('submitting') : t('submit')}
          <span
            aria-hidden
            className="ms-3 inline-block transition-transform duration-300 group-hover:translate-x-1 rtl:rotate-180"
          >
            &rarr;
          </span>
        </button>

        <p className="text-[12.5px] leading-relaxed text-moss-muted">{t('fineprint')}</p>
      </form>
    </AuthShell>
  );
}
