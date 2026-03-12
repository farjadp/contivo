import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Merge Tailwind classes safely, resolving conflicts.
 * This is the standard shadcn/ui utility function.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Format a number as a locale-aware credit balance string.
 */
export function formatCredits(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

/**
 * Truncate text to a max character length.
 */
export function truncate(text: string, maxLen = 100): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen)}…`;
}

/**
 * Sleep for ms milliseconds. Useful for dev stubs.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
