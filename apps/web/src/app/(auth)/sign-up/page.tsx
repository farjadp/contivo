'use client';

import { useActionState } from 'react';
import Link from 'next/link';

import { register } from '@/app/actions/auth';
import { AuthField, AuthShell } from '@/components/marketing/auth-shell';

const initialState = { error: '' };

export default function SignUpPage() {
  const [state, formAction, isPending] = useActionState(register as never, initialState);

  return (
    <AuthShell
      eyebrow="Create your workspace"
      title="Give it your website."
      accent="Keep"
      titleTail="the rest of your day."
      blurb="One URL is all it needs. Contivo reads your site into a brand memory, maps the competitors you actually have, and only then starts writing."
      footer={
        <>
          Already have an account?{' '}
          <Link
            href="/sign-in"
            className="font-semibold text-carbon underline decoration-carbon/30 underline-offset-4 transition-colors hover:decoration-brick"
          >
            Sign in
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
          id="name"
          label="Your name"
          type="text"
          autoComplete="name"
          placeholder="Farjad"
        />
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
          autoComplete="new-password"
          placeholder="At least 10 characters"
        />

        <button
          type="submit"
          disabled={isPending}
          className="group w-full bg-carbon px-7 py-4 text-[14.5px] font-semibold text-paper-warm transition-colors duration-300 hover:bg-brick disabled:opacity-60"
        >
          {isPending ? 'Creating…' : 'Create my workspace'}
          <span
            aria-hidden
            className="ml-3 inline-block transition-transform duration-300 group-hover:translate-x-1"
          >
            &rarr;
          </span>
        </button>

        <p className="text-[12.5px] leading-relaxed text-carbon-60">
          Free while Contivo is in early access. No card, and nothing publishes anywhere until you
          connect a channel yourself.
        </p>
      </form>
    </AuthShell>
  );
}
