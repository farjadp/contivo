/**
 * format.ts — every number and date a report prints.
 *
 * The old report called `toLocaleDateString('en-US')` with the locale written
 * into the call, so a Persian report carried an English date in Latin digits.
 * A report is a document someone forwards to a client; a date in the wrong
 * script on page one is the first thing they notice.
 *
 * Persian readers date business documents in the Jalali calendar, so that is
 * what a Persian report leads with. The Gregorian date follows in parentheses
 * because the report is also filed, mailed and cited by people who work in it.
 */

import type { ContentLanguage } from '@/lib/content-language';

/**
 * Gregorian dates in Persian digits. `nu-arabext` is the Eastern Arabic-Indic
 * set Iran uses (۰۱۲۳), not the Arabic-Indic set of the Gulf states (٠١٢٣) —
 * picking the wrong one is legible but visibly foreign.
 */
const FA_GREGORIAN = 'fa-IR-u-ca-gregory-nu-arabext';
/** The Jalali calendar, same digits. */
const FA_JALALI = 'fa-IR-u-ca-persian-nu-arabext';

const LONG_DATE: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
};

/**
 * The date as it appears on the cover and in the footer.
 *
 * English: `26 September 2026`.
 * Persian: `۵ مهر ۱۴۰۵ (۲۶ سپتامبر ۲۰۲۶)` — Jalali first, Gregorian in hand.
 */
export function formatReportDate(date: Date, language: ContentLanguage): string {
  if (language !== 'FA') {
    return new Intl.DateTimeFormat('en-GB', LONG_DATE).format(date);
  }
  const jalali = new Intl.DateTimeFormat(FA_JALALI, LONG_DATE).format(date);
  const gregorian = new Intl.DateTimeFormat(FA_GREGORIAN, LONG_DATE).format(date);
  return `${jalali} (${gregorian})`;
}

/** A short machine-ish stamp for the footer of every page. */
export function formatShortDate(date: Date, language: ContentLanguage): string {
  const locale = language === 'FA' ? FA_JALALI : 'en-GB';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Counts, scores and any other digit that appears in prose. */
export function formatNumber(value: number, language: ContentLanguage): string {
  const locale = language === 'FA' ? FA_GREGORIAN : 'en-GB';
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * A human reference for one report: `CTV-R-260926-4F2A`.
 *
 * Deliberately not the database cuid. A cuid is 25 characters of base36 that
 * nobody can read down a phone line, and it is also the primary key — printing
 * it on a document that gets forwarded hands out an internal identifier for
 * free. This is short, unique enough to find the row, and safe to say aloud.
 */
export function reportReference(id: string, date: Date): string {
  const yy = String(date.getFullYear()).slice(-2);
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const tail = id.slice(-4).toUpperCase();
  return `CTV-R-${yy}${mm}${dd}-${tail}`;
}
