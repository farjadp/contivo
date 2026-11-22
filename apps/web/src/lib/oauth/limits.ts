/**
 * Sign-in and sign-up limits shared with the password path.
 *
 * MUST match LOGIN_PER_IP and REGISTER_PER_IP in app/actions/auth.ts (that
 * file is a 'use server' module and cannot export constants). The register
 * bucket is the same key (`register:ip:<ip>`), so an attacker cannot get
 * five password sign-ups plus five more through Google.
 */

export const MINUTE = 60_000;
export const LOGIN_PER_IP = { limit: 40, windowMs: 15 * MINUTE };
export const REGISTER_PER_IP = { limit: 5, windowMs: 60 * MINUTE };
