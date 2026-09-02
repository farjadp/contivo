/**
 * What counts as an acceptable password.
 *
 * Sign-up previously accepted a single character. Combined with unlimited
 * sign-in attempts, that made guessing a real account's password practical.
 *
 * The rules are deliberately short. Length does most of the work, so the floor
 * is 10 rather than 8 and there are no character-class requirements — those
 * push people toward "Password1!" without adding much. The reject list catches
 * the handful of passwords that turn up first in every credential-stuffing run,
 * plus anything containing the product's own name.
 */

const TOO_COMMON = [
  'password',
  'passw0rd',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty',
  'qwertyuiop',
  'iloveyou',
  'letmein',
  'welcome',
  'admin',
  'abc123',
  'contivo',
];

export const MIN_PASSWORD_LENGTH = 10;

/**
 * Returns an error message to show the person, or null when the password is
 * acceptable. The message says what to change — a bare "invalid password"
 * leaves someone guessing at the rule.
 */
export function checkPassword(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. Length matters more than symbols.`;
  }

  if (password.length > 200) {
    return 'That password is too long. Keep it under 200 characters.';
  }

  const lowered = password.toLowerCase();

  if (TOO_COMMON.some((common) => lowered.includes(common))) {
    return 'That password shows up in lists attackers try first. Pick something else.';
  }

  // The local part of their own email is the other password people reach for.
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lowered.includes(localPart)) {
    return 'Do not use your email address in your password.';
  }

  return null;
}
