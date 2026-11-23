'use client';

import { usePathname } from '@/i18n/navigation';
import { useParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { buildClientContext, pushBreadcrumb, pushConsole } from '@/lib/bug-report/client-buffer';
import { REF_COOKIE, type ClientContext } from '@/lib/bug-report/types';
import { workspaceIdFromRoute } from '@/lib/last-workspace';
import { readRefFromCookie, readViewedIds, stripLocale } from './page-signals';
import { RefToast } from './RefToast';
import { ReportSheet } from './ReportSheet';

const POLL_MS = 1500;

type BugReportContextValue = {
  /** Opens the report sheet; a ref attaches that failure to the report. */
  openReport: (prefillRef?: string) => void;
  /** The most recent failure reference seen in this tab, or null. */
  lastRef: string | null;
};

const BugReportContext = createContext<BugReportContextValue | null>(null);

/** Null outside the provider, so an error boundary can fall back to a plain link. */
export function useBugReport(): BugReportContextValue | null {
  return useContext(BugReportContext);
}

/**
 * Mounts once in the signed-in shell. It listens (route changes, data-action
 * clicks, window errors, the failure-ref cookie), keeps everything in memory,
 * and sends nothing until the person presses Send in the sheet.
 */
export function BugReportProvider({ children }: { children: ReactNode }) {
  // `pathname` is the next-intl TEMPLATE (`/growth/[id]`); ids come from params.
  const pathname = usePathname();
  const params = useParams();
  const locale = useLocale();

  const [sheet, setSheet] = useState<{ open: boolean; prefillRef: string | null }>({ open: false, prefillRef: null });
  const [lastRef, setLastRef] = useState<string | null>(null);
  const [toastRef, setToastRef] = useState<string | null>(null);

  // Latest values for listeners that must not re-subscribe on every render.
  const live = useRef({ pathname, locale, workspaceId: null as string | null });
  live.current = { pathname, locale, workspaceId: workspaceIdFromRoute(pathname, params) };
  const seenRef = useRef<string | null>(null);

  // Route changes.
  useEffect(() => {
    pushBreadcrumb({ kind: 'route', label: pathname });
  }, [pathname]);

  // Clicks on data-action elements, window errors, unhandled rejections.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const action = target.closest('[data-action]')?.getAttribute('data-action');
      if (action) pushBreadcrumb({ kind: 'click', label: action });
    };
    const onError = (event: ErrorEvent) => pushConsole('error', event.error ?? event.message);
    const onRejection = (event: PromiseRejectionEvent) => pushConsole('rejection', event.reason);
    document.addEventListener('click', onClick, true);
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  // The failure-ref cookie, set by the server when an action fails. Polled only
  // while the tab is visible, and on focus.
  useEffect(() => {
    const check = (announce: boolean) => {
      const value = readRefFromCookie(document.cookie, REF_COOKIE);
      if (!value || value === seenRef.current) return;
      seenRef.current = value;
      setLastRef(value);
      if (!announce) return; // already there when the page loaded: reportable, but not news
      pushBreadcrumb({ kind: 'action_failed', label: 'action_failed', ref: value });
      setToastRef(value);
    };
    check(false);
    const tick = () => {
      if (document.visibilityState === 'visible') check(true);
    };
    const timer = setInterval(tick, POLL_MS);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  const getContext = useCallback((): ClientContext => {
    const { pathname: route, locale: loc, workspaceId } = live.current;
    return buildClientContext({
      route,
      path: stripLocale(window.location.pathname, loc),
      locale: loc,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      viewedIds: readViewedIds(document, workspaceId),
    });
  }, []);

  const openReport = useCallback((prefillRef?: string) => {
    setToastRef(null);
    setSheet({ open: true, prefillRef: prefillRef ?? null });
  }, []);

  const value = useMemo(() => ({ openReport, lastRef }), [openReport, lastRef]);

  return (
    <BugReportContext.Provider value={value}>
      {children}
      <RefToast refCode={sheet.open ? null : toastRef} onReport={openReport} onDismiss={() => setToastRef(null)} />
      {sheet.open && (
        <ReportSheet
          prefillRef={sheet.prefillRef}
          fallbackRef={lastRef}
          getContext={getContext}
          onClose={() => setSheet({ open: false, prefillRef: null })}
        />
      )}
    </BugReportContext.Provider>
  );
}
