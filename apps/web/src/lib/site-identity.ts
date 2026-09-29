/**
 * Who stands behind the public site.
 *
 * The legal pages name this entity as the party to the agreement and this
 * address as the place to send privacy requests, so the two values live in
 * one place and come from the environment. The fallbacks are the real values
 * as of September 2026, not placeholders: a build without the variables must
 * still print a working address rather than an empty mailto.
 */
export const siteIdentity = {
  entity: process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim() || 'AshaVid',
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || 'farjad@ashavid.ca',
} as const;

/** Fills the `{entity}` and `{email}` slots a raw message string carries. */
export function fillIdentity(text: string): string {
  return text.replaceAll('{entity}', siteIdentity.entity).replaceAll('{email}', siteIdentity.email);
}
