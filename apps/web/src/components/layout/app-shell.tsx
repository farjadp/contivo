'use client';

/**
 * AppShell — Main layout wrapper for all dashboard pages.
 *
 * A vertical sidebar + scrollable main content area.
 * Design: clean white sidebar, indigo active states, minimal borders.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ElementType, ReactNode } from 'react';
import { Zap, TrendingUp, Settings, LayoutDashboard, LogOut, Share2 } from 'lucide-react';
import { logout } from '@/app/actions/auth';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Dashboard',      href: '/dashboard',    icon: LayoutDashboard },
  { label: 'Growth Engine',  href: '/growth',       icon: TrendingUp },
  { label: 'Connections',    href: '/connections',  icon: Share2 },
  { label: 'Instant Content',href: '/instant',      icon: Zap },
  { label: 'Settings',       href: '/settings',     icon: Settings },
];

function SidebarLink({
  href, label, icon: Icon, isActive,
}: { href: string; label: string; icon: ElementType; isActive: boolean }) {
  return (
    <Link
      href={href as any}
      className={cn(
        'flex items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-widest transition-colors rounded-none',
        isActive
          ? 'bg-[#121212] text-[#FDFCF8]'
          : 'text-[#121212]/50 hover:text-[#121212] hover:bg-[#121212]/5',
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Hide the AppShell for specific routes like full-screen onboarding pages
  if (pathname === '/growth/new' || pathname === '/growth/analyzing') {
    return (
      <main className="h-screen w-full overflow-y-auto bg-[#FDFCF8]">
        {children}
      </main>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden bg-[#FDFCF8] text-[#121212]">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col border-r border-[#121212]/10 bg-[#EFECE5] py-8 px-4 hidden md:flex">
        {/* Logo */}
        <div className="px-4 mb-12">
          <span className="text-2xl font-black tracking-tighter text-[#121212]">Contivo<span className="text-[#C04C36]">.</span></span>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-2 flex-1 mt-4">
          {NAV_ITEMS.map((item) => (
            <SidebarLink
              key={item.href}
              {...item}
              isActive={
                item.href === '/dashboard'
                  ? pathname === '/dashboard'
                  : pathname.startsWith(item.href)
              }
            />
          ))}
        </nav>

        {/* Sign out */}
        <div className="pt-4 border-t border-[#121212]/10 mt-auto">
          <form action={logout}>
            <button className="flex w-full items-center gap-3 px-4 py-3 text-sm font-bold uppercase tracking-widest text-[#C04C36] hover:bg-[#C04C36]/10 transition-colors rounded-none">
              <LogOut className="w-5 h-5 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto pb-10">
        <div className="max-w-7xl mx-auto h-full p-6 md:p-10">
          {children}
        </div>
      </main>
    </div>
  );
}
