/**
 * The cookie the browser's timezone is reported in.
 *
 * Deliberately its own module with no `'use client'` directive. It used to be
 * exported from the client component that writes the cookie, and importing it
 * into the server-side i18n config silently yielded `undefined` — a client
 * module's exports become client references across that boundary, not values.
 * The lookup then missed, every request fell back to UTC, and the fallback was
 * indistinguishable from "no cookie set yet". Shared constants between a client
 * component and server code belong in a neutral file.
 */
export const TIMEZONE_COOKIE = 'tz';

/** A year. The browser's zone rarely changes, and a wrong one self-corrects. */
export const TIMEZONE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
