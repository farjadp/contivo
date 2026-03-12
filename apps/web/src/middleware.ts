import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-default-key-change-in-production';
const encodedKey = new TextEncoder().encode(JWT_SECRET);

const publicRoutes = ['/', '/sign-in', '/sign-up', '/pricing'];

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;

  const isPublicRoute =
    publicRoutes.some((route) => path === route || path.startsWith('/api/webhooks')) ||
    path.startsWith('/blog');

  let session: any = null;
  const token = req.cookies.get('auth-token')?.value;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, encodedKey, {
        algorithms: ['HS256'],
      });
      session = payload;
    } catch {
      session = null;
    }
  }

  // Protect all non-public routes
  if (!isPublicRoute && !session) {
    const url = new URL('/sign-in', req.url);
    url.searchParams.set('redirectUrl', path);
    return NextResponse.redirect(url);
  }

  // Redirect logged-in users away from auth pages
  if (session && (path === '/sign-in' || path === '/sign-up')) {
    const dest = session.role === 'ADMIN' ? '/admin' : '/dashboard';
    return NextResponse.redirect(new URL(dest, req.url));
  }

  // Prevent non-admins from accessing /admin
  if (session && path.startsWith('/admin') && session.role !== 'ADMIN') {
    return NextResponse.redirect(new URL('/dashboard', req.url));
  }

  const response = NextResponse.next();
  if (session) {
    response.headers.set('x-user-id', session.userId as string);
    response.headers.set('x-user-role', session.role as string);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
};
