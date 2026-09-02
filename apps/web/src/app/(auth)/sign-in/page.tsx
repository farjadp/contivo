'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { login } from '@/app/actions/auth';
import { AuthField, AuthShell } from '@/components/marketing/auth-shell';

const initialState = { error: '' };

export default function SignInPage() {
  const [state, formAction, isPending] = useActionState(login as never, initialState);

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Your queue kept"
      accent="filling"
      titleTail="itself."
      blurb="Autopilot does not wait for you to log in. Anything it wrote while you were away is in the pipeline, already through the quality gate."
      footer={
        <>
          No account yet?{' '}
          <Link
            href="/sign-up"
            className="font-semibold text-carbon underline decoration-carbon/30 underline-offset-4 transition-colors hover:decoration-brick"
          >
            Start with your website
          </Link>
        </>
      }
    >
      <form action={formAction} className="space-y-8" noValidate>
        {state?.error && (
          <p role="alert" className="border-l-2 border-brick pl-4 text-[14px] text-brick-deep">
            {state.error}
          </p>
        )}

        <AuthField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
        />
        <AuthField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
        />

        <button
          type="submit"
          disabled={isPending}
          className="group w-full bg-carbon px-7 py-4 text-[14.5px] font-semibold text-paper-warm transition-colors duration-300 hover:bg-brick disabled:opacity-60"
        >
          {isPending ? 'Signing in…' : 'Sign in'}
          <span
            aria-hidden
            className="ml-3 inline-block transition-transform duration-300 group-hover:translate-x-1"
          >
            &rarr;
          </span>
        </button>
      </form>
    </AuthShell>
  );
}
