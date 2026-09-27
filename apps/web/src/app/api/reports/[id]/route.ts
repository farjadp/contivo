/**
 * GET /api/reports/:id — a strategy report, for the account that owns it.
 *
 * Reports used to be written into `public/reports/`, which Next serves as
 * static files with no authentication at all: the URL was the only secret, and
 * the workspace id was part of the filename. A report contains a customer's
 * whole market position, so it is exactly the thing that must not be readable
 * by a stranger who guesses a path.
 *
 * `?format=html` returns the editable copy instead of the PDF. A report
 * generated before this route existed has no bytes on the row and 404s here —
 * its old file did not survive a redeploy either.
 */

import { NextResponse } from 'next/server';

import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;
  const wantsHtml = new URL(request.url).searchParams.get('format') === 'html';

  /*
    `userId` is part of the query rather than an `if` after it — the same rule
    the 2 Sep audit landed on, after five actions were found trusting an id
    from the browser. A report belonging to someone else is simply not found.
  */
  const report = await prisma.strategicReport.findFirst({
    where: { id, userId: session.userId as string },
    select: { pdfData: true, htmlData: true, reportDate: true },
  });
  if (!report) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const bytes = wantsHtml ? report.htmlData : report.pdfData;
  if (!bytes) {
    return NextResponse.json(
      { error: 'This report was generated before reports were stored, and its file is gone.' },
      { status: 404 },
    );
  }

  const stamp = report.reportDate.toISOString().slice(0, 10);
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      'Content-Type': wantsHtml ? 'text/html; charset=utf-8' : 'application/pdf',
      'Content-Disposition': `inline; filename="contivo-strategy-${stamp}.${wantsHtml ? 'html' : 'pdf'}"`,
      // Private: a shared cache must never hold one account's report.
      'Cache-Control': 'private, no-store',
    },
  });
}
