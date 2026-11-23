import { getFormatter, getLocale, getTranslations } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { notFound } from 'next/navigation';

import { setReportStatus } from '@/app/actions/bug-reports-admin';
import { Link, getPathname } from '@/i18n/navigation';
import { getReportDetail } from '@/lib/bug-report/admin-queries';
import { REF_PATTERN, type ReportDetail } from '@/lib/bug-report/types';
import { EmptyState, Panel } from '../../_components/AdminUi';
import {
  CauseText,
  DetailRow,
  ReportStatusChip,
  ReportStatusForm,
  ReportTimeline,
  SentryEventId,
} from '../../_components/ReportsUi';

type Props = { params: Promise<{ ref: string }> };

/** One report: the person's words, the coded cause, and the merged timeline. */
export default async function AdminReportDetailPage({ params }: Props) {
  // Pages render in parallel with the layout guard, so check the role here before any query runs.
  const session = await getSession();
  if (!session || session.role !== 'ADMIN') {
    redirect({ href: '/dashboard', locale: await getLocale() });
  }
  const { ref } = await params;
  // A malformed reference cannot match a row; skip the query.
  if (!REF_PATTERN.test(ref)) notFound();

  const t = await getTranslations('bugReport.admin');
  const locale = await getLocale();
  const format = await getFormatter();

  let report: ReportDetail | null;
  try {
    report = await getReportDetail(ref);
  } catch (error) {
    console.error('admin report: detail failed', error instanceof Error ? error.message : 'unknown');
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState text={t('detail.loadFailed')} />
      </div>
    );
  }
  if (!report) notFound();

  // Inline server action: keeps the form a plain <form> and lets the page own what happens after.
  async function save(formData: FormData) {
    'use server';
    await setReportStatus(formData);
  }

  const dateTime = (iso: string) => format.dateTime(new Date(iso), { dateStyle: 'medium', timeStyle: 'short' });
  const viewed = Object.entries(report.viewedIds).filter(([, value]) => Boolean(value));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <a
          href={getPathname({ href: '/admin/reports', locale })}
          className="inline-flex min-h-10 items-center gap-1.5 text-sm font-medium text-moss-muted transition hover:text-moss"
        >
          <span aria-hidden className="inline-block rtl:rotate-180">←</span>
          {t('detail.back')}
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight text-moss">
            <bdi dir="ltr" className="font-plexmono tabular-nums">
              {report.referenceCode}
            </bdi>
          </h1>
          <ReportStatusChip status={report.status} />
        </div>
      </div>

      <Panel title={t('detail.cause')}>
        {report.causeCode ? <CauseText code={report.causeCode} prominent /> : <EmptyState text={t('detail.noCause')} />}
      </Panel>

      <Panel title={t('detail.message')}>
        {report.message ? (
          <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-moss">{report.message}</p>
        ) : (
          <EmptyState text={t('detail.noMessage')} />
        )}
      </Panel>

      <Panel title={t('title')}>
        <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
          <DetailRow label={t('detail.reportedAt')}>{dateTime(report.createdAt)}</DetailRow>
          <DetailRow label={t('detail.resolvedAt')}>{report.resolvedAt ? dateTime(report.resolvedAt) : '-'}</DetailRow>
          <DetailRow label={t('detail.locale')}>
            <bdi dir="ltr">{report.locale ?? '-'}</bdi>
          </DetailRow>
          <DetailRow label={t('detail.route')}>
            <bdi dir="ltr" className="font-plexmono text-[13px]">
              {report.route ?? '-'}
            </bdi>
          </DetailRow>
          <DetailRow label={t('detail.path')}>
            <bdi dir="ltr" className="font-plexmono text-[13px] break-all">
              {report.path ?? '-'}
            </bdi>
          </DetailRow>
          <DetailRow label={t('detail.appVersion')}>
            <bdi dir="ltr" className="font-plexmono text-[13px]">
              {report.appVersion ? report.appVersion.slice(0, 12) : '-'}
            </bdi>
          </DetailRow>
          <DetailRow label={t('detail.user')}>
            {report.user ? (
              <Link
                href={{ pathname: '/admin/users/[userId]', params: { userId: report.user.id } }}
                className="underline underline-offset-2"
              >
                <bdi dir="ltr">{report.user.email ?? report.user.id}</bdi>
              </Link>
            ) : (
              t('detail.unknown')
            )}
          </DetailRow>
          <DetailRow label={t('detail.workspace')}>
            {report.workspace ? (
              <Link
                href={{ pathname: '/admin/workspaces/[workspaceId]', params: { workspaceId: report.workspace.id } }}
                className="underline underline-offset-2"
              >
                {report.workspace.name ?? report.workspace.id}
              </Link>
            ) : (
              t('detail.unknown')
            )}
          </DetailRow>
          <DetailRow label={t('detail.sentry')}>
            <SentryEventId eventId={report.sentryEventId} />
          </DetailRow>
        </dl>
        {viewed.length > 0 ? (
          <div className="mt-5 border-t border-rule pt-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">{t('detail.viewed')}</p>
            <ul className="mt-2 flex flex-col gap-1 font-plexmono text-[12px] text-moss">
              {viewed.map(([key, value]) => (
                <li key={key} className="break-all">
                  <bdi dir="ltr">
                    {key}: {value}
                  </bdi>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel title={t('detail.timeline')}>
        <ReportTimeline items={report.timeline} />
      </Panel>

      <Panel title={t('form.title')}>
        <ReportStatusForm referenceCode={report.referenceCode} current={report.status} action={save} />
      </Panel>

      <Panel title={t('detail.siblings')}>
        {report.groupSiblings.filter((s) => s.referenceCode !== report.referenceCode).length === 0 ? (
          <EmptyState text={t('detail.siblingsEmpty')} />
        ) : (
          <ul className="flex flex-col divide-y divide-rule">
            {report.groupSiblings
              .filter((s) => s.referenceCode !== report.referenceCode)
              .map((sibling) => (
                <li key={sibling.referenceCode} className="flex flex-wrap items-center gap-3 py-2.5">
                  <Link
                    href={{ pathname: '/admin/reports/[ref]', params: { ref: sibling.referenceCode } }}
                    className="font-plexmono text-[13px] font-semibold text-moss underline-offset-2 hover:underline"
                  >
                    <bdi dir="ltr">{sibling.referenceCode}</bdi>
                  </Link>
                  <ReportStatusChip status={sibling.status} />
                  <span className="text-sm text-moss-muted">{dateTime(sibling.createdAt)}</span>
                </li>
              ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
