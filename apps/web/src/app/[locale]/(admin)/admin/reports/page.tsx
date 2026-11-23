import { getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';

import { listReportGroups } from '@/lib/bug-report/admin-queries';
import type { ReportGroupRow } from '@/lib/bug-report/types';
import { EmptyState, Panel } from '../_components/AdminUi';
import { ReportsGroupTable, ReportsStatusFilter, isReportStatus } from '../_components/ReportsUi';

type Props = { searchParams: Promise<{ [key: string]: string | string[] | undefined }> };

/** Reports grouped by fingerprint. The admin layout already guards the route. */
export default async function AdminReportsPage({ searchParams }: Props) {
  // Pages render in parallel with the layout guard, so check the role here before any query runs.
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    redirect({ href: '/dashboard', locale: await getLocale() });
  }
  const t = await getTranslations('bugReport.admin');
  const raw = (await searchParams).status;
  const requested = Array.isArray(raw) ? raw[0] : raw;
  const status = isReportStatus(requested) ? requested : null;

  let rows: ReportGroupRow[] = [];
  let failed = false;
  try {
    rows = await listReportGroups();
  } catch (error) {
    failed = true;
    console.error('admin reports: list failed', error instanceof Error ? error.message : 'unknown');
  }
  const visible = status ? rows.filter((row) => row.status === status) : rows;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-6">
      <div>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-moss">{t('title')}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-moss-muted">{t('blurb')}</p>
      </div>

      <ReportsStatusFilter active={status} />

      <Panel title={t('title')}>
        {failed ? <EmptyState text={t('list.failed')} /> : <ReportsGroupTable rows={visible} />}
      </Panel>
    </div>
  );
}
