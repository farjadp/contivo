'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';

export function GlobalHeader() {
  const pathname = usePathname() || '';

  // Routes that ship their own header. Marketing pages render SiteNav, so
  // leaving them out here stacks two headers on top of each other.
  const hideHeaderRoutes = [
    '/onboarding',
    '/dashboard',
    '/growth',
    '/connections',
    '/instant',
    '/settings',
    '/pricing',
    '/docs',
    // These carry their own brand mark, and a "Sign up" button on the sign-up
    // page is worse than no header at all.
    '/sign-in',
    '/sign-up',
  ];
  const shouldHide = pathname === '/' || hideHeaderRoutes.some(route => pathname.startsWith(route));

  if (shouldHide) return null;

  return (
    <header className="flex items-center justify-end gap-3 px-6 h-16 absolute top-0 w-full z-50 pointer-events-auto">
      <Link href="/sign-in" className="text-sm font-medium text-[#121212] hover:opacity-70 transition-opacity">
        Sign in
      </Link>
      <Link
        href="/sign-up"
        className="bg-[#121212] text-white rounded-full font-medium text-sm h-10 px-5 inline-flex items-center hover:bg-[#C04C36] transition-colors"
      >
        Sign up
      </Link>
    </header>
  );
}
