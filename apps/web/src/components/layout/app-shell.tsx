'use client';

/**
 * AppShell — layout for every signed-in page (Chalk & Saffron).
 *
 * A top bar instead of a side rail: the six-stage loop lives inside each
 * workspace, so the global chrome only has to say where you are and get out
 * of the way. Saffron marks the active destination and nothing else.
 *
 * On phones the same destinations move to a bottom bar within thumb reach.
 * Everything is laid out with logical properties, so Persian mirrors for free.
 */

import { Link, usePathname } from '@/i18n/navigation';
import type { ElementType, ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Sun, Layers, Settings, LogOut, Share2, Zap } from 'lucide-react';

import { logout } from '@/app/actions/auth';
import { LocaleSwitcher } from '@/components/marketing/locale-switcher';
import { cn } from '@/lib/utils';

const NAV_ITEMS = [
  { labelKey: 'nav.overview', href: '/dashboard', icon: Sun },
  { labelKey: 'nav.growth', href: '/growth', icon: Layers },
  { labelKey: 'nav.connections', href: '/connections', icon: Share2 },
  { labelKey: 'nav.instant', href: '/instant', icon: Zap },
  { labelKey: 'nav.settings', href: '/settings', icon: Settings },
] as const;

function isActivePath(pathname: string, href: string) {
  return href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(href);
}

function TopLink({ href, label, isActive }: { href: string; label: string; isActive: boolean }) {
  return (
    <Link
      href={href as never}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'relative flex h-10 items-center rounded-lg px-3 text-[14px] font-medium transition-colors',
        isActive ? 'bg-moss text-chalk' : 'text-moss-muted hover:bg-chalk-sunk hover:text-moss',
      )}
    >
      {isActive && <span aria-hidden className="me-2 h-1.5 w-1.5 rotate-45 bg-saffron" />}
      {label}
    </Link>
  );
}

function BottomLink({
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
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex min-h-[48px] min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-medium',
        isActive ? 'bg-moss text-chalk' : 'text-moss-muted',
      )}
    >
      <Icon className={cn('h-[18px] w-[18px]', isActive ? 'text-saffron' : 'text-moss-muted')} />
      <span className="max-w-full truncate px-1">{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations('shell');

  // Full-bleed flows (workspace creation / analysis) render without chrome.
  if (pathname === '/growth/new' || pathname === '/growth/analyzing') {
    return <main className="theme-chalk h-screen w-full overflow-y-auto bg-chalk font-plex text-moss">{children}</main>;
  }

  const primary = NAV_ITEMS.filter((item) => item.href !== '/settings');

  return (
    <div className="theme-chalk flex h-screen flex-col overflow-hidden bg-chalk font-plex text-moss">
      {/* ── Top bar ──────────────────────────────────────────────────── */}
      <header className="flex h-16 shrink-0 items-center gap-6 border-b border-rule px-4 md:px-8">
        <Link href="/dashboard" className="flex items-center gap-2.5">
          <span aria-hidden className="h-3 w-3 rotate-45 bg-saffron" />
          {/* The wordmark stays Latin in both languages; `bdi` keeps the
              surrounding Persian from reordering it. */}
          <bdi className="font-display text-[22px] font-bold lowercase tracking-tight">contivo</bdi>
        </Link>

        <nav aria-label={t('navLabel')} className="hidden items-center gap-1 md:flex">
          {primary.map((item) => (
            <TopLink
              key={item.href}
              href={item.href}
              label={t(item.labelKey)}
              isActive={isActivePath(pathname, item.href)}
            />
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-2">
          {/* The marketing switcher, re-tinted for chalk rather than forked. */}
          <LocaleSwitcher className="me-2 [&_a:hover]:text-moss [&_a[aria-current]]:text-moss [&_a[aria-current]]:decoration-saffron [&_a]:text-moss-muted" />
          <Link
            href="/settings"
            aria-label={t('nav.settings')}
            aria-current={isActivePath(pathname, '/settings') ? 'page' : undefined}
            className={cn(
              'hidden h-10 w-10 items-center justify-center rounded-full border transition-colors md:flex',
              isActivePath(pathname, '/settings')
                ? 'border-moss bg-moss text-chalk'
                : 'border-rule bg-chalk-raised text-moss hover:border-rule-strong',
            )}
          >
            <Settings className="h-[18px] w-[18px]" />
          </Link>
          <form action={logout}>
            <button
              aria-label={t('signOut')}
              title={t('signOut')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-rule bg-chalk-raised text-moss transition-colors hover:border-rule-strong"
            >
              <LogOut className="h-[18px] w-[18px] rtl:rotate-180" />
            </button>
          </form>
        </div>
      </header>

      {/* ── Working area ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-7xl p-4 pb-28 md:p-10">{children}</div>
      </main>

      {/* ── Phone bar ────────────────────────────────────────────────── */}
      <nav
        aria-label={t('navLabel')}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-[repeat(5,minmax(0,1fr))] gap-1 border-t border-rule bg-chalk-raised px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 md:hidden"
      >
        {NAV_ITEMS.map((item) => (
          <BottomLink
            key={item.href}
            href={item.href}
            icon={item.icon}
            label={t(item.labelKey)}
            isActive={isActivePath(pathname, item.href)}
          />
        ))}
      </nav>
    </div>
  );
}
