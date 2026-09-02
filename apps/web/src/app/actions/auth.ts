/**
 * Sign-in and sign-up.
 *
 * Both were unlimited: any number of password guesses against an account, and
 * any number of accounts from one script. Since every new account receives a
 * credit grant that buys real model calls, the sign-up side was a way to spend
 * the product's own API budget. Both now go through a database-backed limiter,
 * and passwords have a floor.
 */

'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createSessionCookie, deleteSessionCookie } from '@/lib/auth';
import { isUserSuspended } from '@/lib/admin-state';
import { ensureWelcomeCredits } from '@/lib/credits';
import { checkPassword } from '@/lib/password-policy';
import { callerIp, consumeRateLimit, retryAfterLabel } from '@/lib/rate-limit';
import { redirect } from 'next/navigation';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Two buckets per sign-in, because they stop different things: the per-email
 * one stops guessing at one account from many addresses, and the per-IP one
 * stops spraying one password across many accounts. The email bucket is the
 * tighter of the two since a real person rarely mistypes ten times in a row.
 */
const LOGIN_PER_EMAIL = { limit: 10, windowMs: 15 * MINUTE };
const LOGIN_PER_IP = { limit: 40, windowMs: 15 * MINUTE };

/**
 * Sign-up is limited per IP only — there is no account to key on yet. Five an
 * hour is far above what a real person needs and far below what makes
 * harvesting credit grants worth scripting.
 */
const REGISTER_PER_IP = { limit: 5, windowMs: HOUR };

export async function login(_prevState: any, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Please enter both email and password' };
  }

  const ip = await callerIp();
  const [byEmail, byIp] = await Promise.all([
    consumeRateLimit(`login:email:${email.toLowerCase()}`, LOGIN_PER_EMAIL.limit, LOGIN_PER_EMAIL.windowMs),
    consumeRateLimit(`login:ip:${ip}`, LOGIN_PER_IP.limit, LOGIN_PER_IP.windowMs),
  ]);

  const blocked = !byEmail.allowed ? byEmail : !byIp.allowed ? byIp : null;
  if (blocked) {
    // Deliberately the same wording whichever bucket tripped, so the response
    // does not reveal whether this email is the one being guessed at.
    return {
      error: `Too many sign-in attempts. Try again in ${retryAfterLabel(blocked.retryAfter)}.`,
    };
  }

  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user || !user.passwordHash) {
    return { error: 'Invalid credentials' };
  }

  const isValidPassword = await bcrypt.compare(password, user.passwordHash);

  if (!isValidPassword) {
    return { error: 'Invalid credentials' };
  }

  if (await isUserSuspended(user.id)) {
    return { error: 'This account has been suspended. Contact support.' };
  }

  // Backfills accounts created before the welcome grant existed. Idempotent:
  // it only fires when the account has no ledger history at all.
  await ensureWelcomeCredits(user.id);

  await createSessionCookie({
    userId: user.id,
    email: user.email,
    role: user.role, // 'ADMIN' or 'USER'
  });

  if (user.role === 'ADMIN') {
    redirect('/admin');
  } else {
    redirect('/dashboard');
  }
}

export async function register(_prevState: any, formData: FormData) {
  const name = formData.get('name') as string;
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!name || !email || !password) {
    return { error: 'Please fill out all fields' };
  }

  const passwordProblem = checkPassword(password, email);
  if (passwordProblem) {
    return { error: passwordProblem };
  }

  const ip = await callerIp();
  const throttle = await consumeRateLimit(
    `register:ip:${ip}`,
    REGISTER_PER_IP.limit,
    REGISTER_PER_IP.windowMs,
  );
  if (!throttle.allowed) {
    return {
      error: `Too many accounts created from here. Try again in ${retryAfterLabel(throttle.retryAfter)}.`,
    };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return { error: 'User already exists' };
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: 'USER',
      plan: 'FREE',
    },
  });

  // Nothing outside the admin console ever wrote an ALLOCATION row, so every
  // account started at a zero balance and the first paid action was refused.
  await ensureWelcomeCredits(user.id);

  await createSessionCookie({
    userId: user.id,
    email: user.email,
    role: user.role,
  });

  if (user.role === 'ADMIN') {
    redirect('/admin');
  } else {
    redirect('/dashboard');
  }
}

export async function logout() {
  await deleteSessionCookie();
  redirect('/sign-in');
}
