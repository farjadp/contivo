'use client';

import { useActionState } from 'react';
import { register } from '@/app/actions/auth';
import Link from 'next/link';

const initialState = { error: '' };

export default function SignUpPage() {
  const [state, formAction, isPending] = useActionState(register as any, initialState);

  return (
    <div className="flex min-h-screen w-full items-center justify-center p-4 bg-[#F9F9F9]">
      <div className="w-full max-w-sm space-y-8 bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight text-[#121212]">Create an account</h1>
          <p className="text-sm text-gray-500 mt-2">Start generating intelligent content</p>
        </div>

        <form 
          action={formAction} 
          className="space-y-6"
        >
          {state?.error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-md border border-red-100 text-center">
              {state.error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#121212] mb-1.5" htmlFor="name">
                Full Name
              </label>
              <input
                id="name"
                name="name"
                type="text"
                required
                className="block w-full rounded-md border border-gray-200 px-3 py-2 text-[#121212] placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black sm:text-sm"
                placeholder="John Doe"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#121212] mb-1.5" htmlFor="email">
                Email Address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                className="block w-full rounded-md border border-gray-200 px-3 py-2 text-[#121212] placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black sm:text-sm"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#121212] mb-1.5" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                className="block w-full rounded-md border border-gray-200 px-3 py-2 text-[#121212] placeholder-gray-400 focus:border-black focus:outline-none focus:ring-1 focus:ring-black sm:text-sm"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="flex w-full justify-center rounded-md bg-[#121212] px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-black/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-50 transition-colors"
          >
            {isPending ? 'Creating account...' : 'Create account'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500">
          Already have an account?{' '}
          <Link href={"/sign-in" as any} className="font-semibold leading-6 text-[#121212] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
