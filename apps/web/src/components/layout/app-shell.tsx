'use client';

/**
 * AppShell — layout for every signed-in page.
 *
 * Dark "control room" rail on the left, paper-white working area on the
 * right. The rail carries the product's one accent (signal green) only on
 * the active item and the Autopilot state, so the eye lands where the
 * machine is running.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ElementType, ReactNode } from 'react';
import { Zap, TrendingUp, Settings, LayoutDashboard, LogOut, Share2, Bot } from 'lucide-react';

import { logout } from '@/app/actions/auth';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Growth Engine', href: '/growth', icon: TrendingUp },
  { label: 'Connections', href: '/connections', icon: Share2 },
  { label: 'Instant Content', href: '/instant', icon: Zap },
  { label: 'Settings', href: '/settings', icon: Settings },
] as const;

function RailLink({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: ElementType;
  isActive: boolean;
}) {
  return (
    <Link
      href={href as never}
      className={cn(
        'group relative flex items-center gap-3 px-4 py-2.5 text-[13px] font-medium transition-colors',
        isActive ? 'text-white' : 'text-ink-300 hover:text-white',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1/2 h-5 w-[2px] -translate-y-1/2 transition-colors',
          isActive ? 'bg-signal' : 'bg-transparent group-hover:bg-ink-600',
        )}
      />
      <Icon className={cn('h-4 w-4 shrink-0', isActive ? 'text-signal' : 'text-ink-400 group-hover:text-ink-200')} />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Full-bleed flows (workspace creation / analysis) render without the rail.
  if (pathname === '/growth/new' || pathname === '/growth/analyzing') {
    return <main className="h-screen w-full overflow-y-auto bg-paper text-ink-900">{children}</main>;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-paper text-ink-900">
      {/* ── Rail ─────────────────────────────────────────────────────── */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-800 bg-ink-950 md:flex">
        <div className="flex h-14 items-center gap-2 border-b border-ink-800 px-5">
          <span className="inline-block h-2.5 w-2.5 bg-signal shadow-[0_0_10px_rgba(61,255,143,0.7)]" />
          <span className="font-display text-[15px] font-bold tracking-tight text-white">Contivo</span>
        </div>

        <nav className="mt-4 flex flex-1 flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <RailLink
              key={item.href}
              {...item}
              isActive={item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href)}
            />
          ))}
        </nav>

        <div className="border-t border-ink-800 px-4 py-3">
          <div className="mb-3 flex items-center gap-2 px-1 font-mono text-[10.5px] uppercase tracking-widest text-ink-400">
            <Bot className="h-3.5 w-3.5" />
            autopilot-ready build
          </div>
          <form action={logout}>
            <button className="flex w-full items-center gap-3 px-1 py-2 text-[13px] text-ink-300 transition-colors hover:text-white">
              <LogOut className="h-4 w-4 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Working area ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-6 md:p-10">{children}</div>
      </main>
    </div>
  );
}
