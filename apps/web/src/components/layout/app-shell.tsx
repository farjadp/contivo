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
        'flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all',
        isActive
          ? 'bg-[#2B2DFF] text-white shadow-sm shadow-indigo-200'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100',
      )}
    >
      <Icon className="w-4 h-4 shrink-0" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="h-screen flex overflow-hidden bg-[#F6F7FB] p-3 sm:p-5 gap-5">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="w-64 shrink-0 flex flex-col rounded-[32px] border border-white/40 bg-white/70 backdrop-blur-xl py-6 px-4 gap-1 shadow-[0_8px_30px_rgb(0,0,0,0.04)] hidden md:flex">
        {/* Logo */}
        <div className="px-4 mb-8 mt-2">
          <span className="text-2xl font-black tracking-tighter text-[#2B2DFF]">Contivo</span>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1.5 flex-1 mt-4">
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
        <div className="pt-4">
          <form action={logout}>
            <button className="flex w-full items-center gap-3 px-4 py-3 rounded-2xl text-sm font-bold text-red-500 hover:bg-red-50 hover:text-red-600 transition-colors">
              <LogOut className="w-5 h-5 shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* ── Main ───────────────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto rounded-[32px] pb-10">
        <div className="max-w-7xl mx-auto h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
