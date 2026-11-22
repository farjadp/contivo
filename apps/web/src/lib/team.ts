/**
 * team.ts — the founders shown on /team, confirmed by Farjad on 22 Nov 2026.
 *
 * Names and roles live in the `team` namespace under `founders.<key>`.
 * A founder shows initials until `photo` names a file in public/founders/.
 */

export const FOUNDERS: ReadonlyArray<{ key: string; linkedin?: string; photo?: string }> = [
  { key: 'mohajer' },
  { key: 'souzangar', linkedin: 'https://www.linkedin.com/in/souzangar' },
  { key: 'kavian', linkedin: 'https://www.linkedin.com/in/mohsen-kavian' },
  { key: 'khamouddoust', linkedin: 'https://www.linkedin.com/in/baharehkhamouddoust' },
];

/**
 * First letters of the first and last word, for the placeholder avatar.
 * In Persian two initials written side by side join into a word ("حس"), so a
 * zero-width non-joiner keeps them apart; Latin initials are uppercased.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  const first = words[0]?.[0] ?? '';
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? '') : '';
  if (/[A-Za-z]/.test(first)) return `${first}${last}`.toUpperCase();
  return [first, last].filter(Boolean).join('\u200c');
}
