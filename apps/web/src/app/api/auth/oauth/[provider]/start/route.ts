import type { NextRequest } from 'next/server';

import { handleStart } from '@/lib/oauth/start';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  return handleStart(request, provider);
}
