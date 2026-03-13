import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '@/lib/auth';

const ADMIN_NAV_ITEMS = [
  { href: '/admin?section=overview', label: 'Overview' },
  { href: '/admin?section=users', label: 'Users' },
  { href: '/admin?section=workspaces', label: 'Workspaces' },
  { href: '/admin?section=content', label: 'Content' },
  { href: '/admin?section=ai', label: 'AI & Models' },
  { href: '/admin?section=integrations', label: 'SEO Intelligence' },
  { href: '/admin?section=credits', label: 'Credits & Billing' },
  { href: '/admin?section=jobs', label: 'Queues & Jobs' },
  { href: '/admin?section=settings', label: 'Platform Settings' },
  { href: '/admin?section=logs', label: 'Logs & Security' },
  { href: '/admin?section=analytics', label: 'Analytics' },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSession();

  if (!user) {
    redirect('/sign-in?redirectUrl=/admin');
  }

  if (user.role !== 'ADMIN') {
    redirect('/dashboard');
  }

  return (
    <div className="flex min-h-screen w-full bg-[#F7F7F5]">
      <aside className="hidden w-72 flex-shrink-0 border-r border-gray-200 bg-white md:block">
        <div className="sticky top-0 flex min-h-screen flex-col p-6">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">Operations</p>
            <h2 className="mt-3 text-2xl font-bold tracking-tight text-[#121212]">Contivo Admin</h2>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Internal control plane for platform health, AI cost, credits, and runtime rules.
            </p>
          </div>

          <nav className="mt-8 space-y-2">
            {ADMIN_NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="block rounded-xl border border-transparent px-4 py-3 text-sm font-semibold text-slate-600 transition hover:border-gray-200 hover:bg-slate-50 hover:text-black"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="mt-auto border-t border-gray-100 pt-6">
            <p className="px-4 text-xs font-medium text-slate-500">
              {user.email}
              <span className="ml-1 text-slate-400">({user.role})</span>
            </p>
            <Link href="/" className="mt-3 block px-4 py-2 text-sm font-medium text-gray-500 hover:text-black">
              ← Back to App
            </Link>
            <form action={async () => {
              'use server';
              const { logout } = await import('@/app/actions/auth');
              await logout();
            }}>
              <button type="submit" className="w-full text-left mt-2 block px-4 py-2 text-sm font-medium text-red-500 hover:text-red-600 transition-colors">
                Sign out
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
