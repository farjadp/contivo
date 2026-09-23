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
 * Returns a message key describing what is wrong, or null when the password is
 * acceptable. The message says what to change — a bare "invalid password"
 * leaves someone guessing at the rule.
 *
 * A key rather than a sentence, because this is the message a person reads at
 * the moment they are trying to create an account, and it has to arrive in
 * their language. It stays a pure function so the rules can be unit-tested
 * without a request context; `auth.ts` turns the key into words.
 */
export type PasswordProblem = 'tooShort' | 'tooLong' | 'tooCommon' | 'containsEmail';

export function checkPassword(password: string, email?: string): PasswordProblem | null {
  if (password.length < MIN_PASSWORD_LENGTH) return 'tooShort';
  if (password.length > 200) return 'tooLong';

  const lowered = password.toLowerCase();
  if (TOO_COMMON.some((common) => lowered.includes(common))) return 'tooCommon';

  // The local part of their own email is the other password people reach for.
  const localPart = email?.split('@')[0]?.toLowerCase();
  if (localPart && localPart.length >= 4 && lowered.includes(localPart)) return 'containsEmail';

  return null;
}
