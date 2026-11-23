'use server';

import { revalidatePath } from 'next/cache';

import { redirect } from '@/i18n/navigation';
import { writeActivityLog } from '@/lib/activity-log';
import { getSession } from '@/lib/auth';
import { isRef } from '@/lib/bug-report/ref';
import { REPORT_STATUSES, type ReportStatus } from '@/lib/bug-report/types';
import { prisma } from '@/lib/db';
import { getLocale } from 'next-intl/server';

// Same guard as actions/admin.ts (kept private there, so copied rather than edited).
async function requireAdmin() {
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    redirect({ href: '/dashboard', locale: await getLocale() });
  }
  return session!;
}

/** Form action: referenceCode, status, optional applyToGroup checkbox. */
export async function setReportStatus(formData: FormData): Promise<void> {
  const session = await requireAdmin();

  const referenceCode = String(formData.get('referenceCode') ?? '').trim();
  const status = String(formData.get('status') ?? '').trim() as ReportStatus;
  const applyToGroup = formData.get('applyToGroup') !== null && formData.get('applyToGroup') !== 'false';

  if (!isRef(referenceCode) || !REPORT_STATUSES.includes(status)) {
    console.warn('setReportStatus: rejected invalid input');
    return;
  }

  const report = await prisma.bugReport.findUnique({
    where: { referenceCode },
    select: { id: true, fingerprint: true },
  });
  if (!report) {
    console.warn('setReportStatus: report not found');
    return;
  }

  const closed = status === 'FIXED' || status === 'WONTFIX';
  const data = { status, resolvedAt: closed ? new Date() : null };
  const result = applyToGroup
    ? await prisma.bugReport.updateMany({ where: { fingerprint: report.fingerprint }, data })
    : await prisma.bugReport.updateMany({ where: { id: report.id }, data });

  await writeActivityLog({
    userId: session.userId as string,
    action: 'ADMIN_BUG_REPORT_STATUS',
    detail: { ref: referenceCode, status, group: applyToGroup, updated: result.count },
  });
  revalidatePath('/admin/reports');
}
