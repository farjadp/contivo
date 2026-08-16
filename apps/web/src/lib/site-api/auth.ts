/**
 * site-api/auth.ts
 *
 * Authenticates requests to the public Content API.
 *
 * Every response deliberately reveals as little as possible: an unknown key,
 * a disabled site and a revoked site all return the same 401 body. The caller
 * learns only whether their key works.
 */

import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';

import { extractBearerKey, hashSiteKey } from './keys';

export type AuthedSite = {
  id: string;
  workspaceId: string;
  name: string;
};

type AuthResult = { site: AuthedSite } | { response: NextResponse };

const UNAUTHORIZED = {
  error: 'unauthorized',
  message: 'Provide a valid site API key as: Authorization: Bearer <key>',
};

export async function authenticateSite(request: Request): Promise<AuthResult> {
  const key = extractBearerKey(request.headers.get('authorization'));
  if (!key) {
    return { response: NextResponse.json(UNAUTHORIZED, { status: 401 }) };
  }

  const site = await prisma.siteConnection.findUnique({
    where: { keyHash: hashSiteKey(key) },
    select: { id: true, workspaceId: true, name: true, status: true },
  });

  // Same response for "no such key" and "key exists but is switched off":
  // an attacker should not be able to enumerate valid keys.
  if (!site || site.status !== 'ACTIVE') {
    return { response: NextResponse.json(UNAUTHORIZED, { status: 401 }) };
  }

  // Best-effort usage stamp; never let it fail the request.
  prisma.siteConnection
    .update({ where: { id: site.id }, data: { lastFetchedAt: new Date() } })
    .catch(() => undefined);

  return { site: { id: site.id, workspaceId: site.workspaceId, name: site.name } };
}

/** CORS: these endpoints are read-only and key-authenticated. */
export const API_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Cache-Control': 'no-store',
};

export function apiJson(body: unknown, init?: { status?: number }) {
  return NextResponse.json(body, { status: init?.status ?? 200, headers: API_HEADERS });
}
