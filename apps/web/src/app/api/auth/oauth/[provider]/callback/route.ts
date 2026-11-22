import type { NextRequest } from 'next/server';

import { handleCallback } from '@/lib/oauth/callback';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return handleCallback(request, provider);
}
