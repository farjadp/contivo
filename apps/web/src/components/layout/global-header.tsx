'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { SignInButton, SignUpButton, UserButton } from '@clerk/nextjs';
import { Show } from '@clerk/nextjs';

const isClerkEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function GlobalHeader() {
  const pathname = usePathname() || '';

  // Hide the global header on onboarding and dashboard routes where we have custom layouts
  const hideHeaderRoutes = ['/onboarding', '/dashboard', '/growth', '/connections', '/instant', '/settings'];
  const shouldHide = hideHeaderRoutes.some(route => pathname.startsWith(route));

  if (shouldHide) return null;

  return (
    <header className="flex items-center justify-end gap-3 px-6 h-16 absolute top-0 w-full z-50 pointer-events-auto">
      {isClerkEnabled ? (
        <>
          <Show when="signed-out">
            <SignInButton />
            <SignUpButton>
              <button className="bg-[#6c47ff] text-white rounded-full font-medium text-sm h-10 px-4">
                Sign Up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </>
      ) : (
        <>
          <Link href={"/sign-in" as any} className="text-sm font-medium text-[#121212]">
            Sign in
          </Link>
          <Link
            href={"/sign-up" as any}
            className="bg-[#6c47ff] text-white rounded-full font-medium text-sm h-10 px-4 inline-flex items-center"
          >
            Sign Up
          </Link>
        </>
      )}
    </header>
  );
}
