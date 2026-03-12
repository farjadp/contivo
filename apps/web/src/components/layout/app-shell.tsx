'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Zap, TrendingUp, Settings, Coins, LayoutDashboard, LogOut } from 'lucide-react';
import { logout } from '@/app/actions/auth';

import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { label: 'Overview', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Instant Content', href: '/instant', icon: Zap },
  { label: 'Growth Engine', href: '/growth', icon: TrendingUp },
  { label: 'Credits', href: '/credits', icon: Coins },
  { label: 'Settings', href: '/settings', icon: Settings },
];

function SidebarLink({
  href,
  label,
  icon: Icon,
  isActive,
}: {
  href: string;
  label: string;
  icon: React.ElementType;
  isActive: boolean;
}) {
  return (
    <Link
      href={href as any}
      className={cn(
        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-60 border-r border-border flex flex-col py-6 px-4 gap-2 shrink-0">
        {/* Logo */}
        <div className="px-3 mb-8 mt-2">
          <Link href="/" className="text-2xl font-bold tracking-tight text-gradient">
            Contivo
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-1 flex-1">
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

        {/* User / Logout */}
        <div className="border-t border-border pt-4 px-1">
          <form action={logout}>
            <button className="flex w-full items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
              <LogOut className="w-4 h-4 flex-shrink-0" />
              Sign out
            </button>
          </form>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <div className="max-w-6xl mx-auto p-8">{children}</div>
      </main>
    </div>
  );
}
