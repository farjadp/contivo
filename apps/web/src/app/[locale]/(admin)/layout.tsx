import { Link, redirect } from '@/i18n/navigation';

import { getSession } from '@/lib/auth';
import { getLocale, getTranslations } from 'next-intl/server';

/*
  Labels are message keys rather than words: the href stays in the locale-aware
  object form so the section link keeps its prefix, and the visible text comes
  out of the catalogue.
*/
const ADMIN_NAV_ITEMS = [
  { href: { pathname: '/admin', query: { section: 'overview' } }, key: 'overview' },
  { href: { pathname: '/admin', query: { section: 'users' } }, key: 'users' },
  { href: { pathname: '/admin', query: { section: 'workspaces' } }, key: 'workspaces' },
  { href: { pathname: '/admin', query: { section: 'content' } }, key: 'content' },
  { href: { pathname: '/admin', query: { section: 'ai' } }, key: 'ai' },
  { href: { pathname: '/admin', query: { section: 'integrations' } }, key: 'integrations' },
  { href: { pathname: '/admin', query: { section: 'credits' } }, key: 'credits' },
  { href: { pathname: '/admin', query: { section: 'jobs' } }, key: 'jobs' },
  { href: { pathname: '/admin', query: { section: 'settings' } }, key: 'settings' },
  { href: { pathname: '/admin', query: { section: 'logs' } }, key: 'logs' },
  { href: { pathname: '/admin', query: { section: 'analytics' } }, key: 'analytics' },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();
  const t = await getTranslations('admin');

  if (!user) {
    redirect({ href: { pathname: '/sign-in', query: { redirectUrl: '/admin' } }, locale: await getLocale() });
  }

  if (user.role !== 'ADMIN') {
    redirect({ href: '/dashboard', locale: await getLocale() });
  }

  return (
    <div className="flex min-h-screen w-full bg-[#F7F7F5]">
      {/*
        The rail sits on the side the language starts from, so `border-e` and
        the logical padding below follow the reader rather than staying pinned
        to the physical left in Persian.
      */}
      <aside className="hidden w-72 flex-shrink-0 border-e border-gray-200 bg-white md:block">
        <div className="sticky top-0 flex min-h-screen flex-col p-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">{t('shell.eyebrow')}</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#121212]">{t('shell.title')}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">{t('shell.blurb')}</p>
          </div>

          <nav className="mt-8 space-y-2">
            {ADMIN_NAV_ITEMS.map((item) => (
              <Link
                key={item.key}
                href={item.href}
                className="block rounded-xl border border-transparent px-4 py-3 text-start text-sm font-semibold text-slate-600 transition hover:border-gray-200 hover:bg-slate-50 hover:text-black"
              >
                {t(`nav.${item.key}`)}
              </Link>
            ))}
          </nav>

          <div className="mt-auto border-t border-gray-100 pt-6">
            <p className="px-4 text-xs font-medium text-slate-500">
              <span dir="ltr">{user.email}</span>
              <span className="ms-1 text-slate-400">({user.role})</span>
            </p>
            <Link href="/" className="mt-3 flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-gray-500 hover:text-black">
              <span aria-hidden className="inline-block rtl:rotate-180">←</span>
              {t('shell.backToApp')}
            </Link>
            <form action={async () => {
              'use server';
              const { logout } = await import('@/app/actions/auth');
              await logout();
            }}>
              <button type="submit" className="w-full text-start mt-2 block px-4 py-2 text-sm font-medium text-red-500 hover:text-red-600 transition-colors">
                {t('shell.signOut')}
              </button>
            </form>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-6 md:p-8">
        <div className="mx-auto max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  );
}
