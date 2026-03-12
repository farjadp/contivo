'use server';

import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { createSessionCookie, deleteSessionCookie } from '@/lib/auth';
import { redirect } from 'next/navigation';

export async function login(_prevState: any, formData: FormData) {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return { error: 'Please enter both email and password' };
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
