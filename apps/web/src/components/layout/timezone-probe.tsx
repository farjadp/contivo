'use client';

import { useEffect } from 'react';

import { TIMEZONE_COOKIE, TIMEZONE_COOKIE_MAX_AGE } from '@/lib/timezone-cookie';

/**
 * Tells the server which timezone the visitor is actually in.
 *
 * Dates are formatted on the server so they match between the server-rendered
 * HTML and the client, and that means the server has to be told a zone. Before
 * the app was translated, timestamps were formatted with `toLocaleDateString()`
 * in the browser, so they were always the reader's local time. Moving
 * formatting to the server replaced that with a fixed zone, and an English
 * reader in Toronto started seeing UTC — a timestamp four hours wrong, shown
 * with no indication that it was.
 *
 * This writes the browser's IANA zone to a cookie so the server can format in
 * it. The very first render of a new session still uses the fallback, then the
 * cookie is set and every render after that is correct; there is no way around
 * that first render, because the server genuinely does not know yet.
 *
 * It writes only when the value changed, so it is a no-op on almost every load,
 * and it stores a timezone name and nothing else.
 */
export function TimezoneProbe() {
  useEffect(() => {
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (!zone) return;

      const current = document.cookie
        .split('; ')
        .find((c) => c.startsWith(`${TIMEZONE_COOKIE}=`))
        ?.slice(TIMEZONE_COOKIE.length + 1);

      if (current === encodeURIComponent(zone)) return;

      document.cookie = `${TIMEZONE_COOKIE}=${encodeURIComponent(zone)}; path=/; max-age=${TIMEZONE_COOKIE_MAX_AGE}; samesite=lax`;

      /*
        The page on screen was rendered with the old zone, so it has to be
        rendered again to pick up the new one.

        The reload is gated on a flag that survives only this tab. Where cookies
        are blocked the write above silently does nothing, the check at the top
        never matches, and without this gate the page would reload forever —
        the worst possible outcome for a cosmetic timestamp fix. With it, a
        browser that refuses cookies reloads once and then keeps the fallback
        zone, which is exactly the right trade.
      */
      const RELOAD_GUARD = 'tz-probe-reloaded';
      if (sessionStorage.getItem(RELOAD_GUARD)) return;
      sessionStorage.setItem(RELOAD_GUARD, '1');
      window.location.reload();
    } catch {
      // A browser that will not report its zone keeps the fallback. Nothing to do.
    }
  }, []);

  return null;
}
