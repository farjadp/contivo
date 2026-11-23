import { Activity, Bot, Monitor, PlayCircle, Send, type LucideIcon } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import type { ReactNode } from 'react';

import { Link } from '@/i18n/navigation';
import { RefChip } from '@/components/bug-report/RefChip';
import {
  CAUSE_CODES,
  REPORT_STATUSES,
  type CauseCode,
  type ReportGroupRow,
  type ReportStatus,
  type TimelineItem,
} from '@/lib/bug-report/types';
import { cn } from '@/lib/utils';

/*
  Safe rendering rule for this file: the user's message and every string that
  came out of a stored context are React text children, never markup. No
  raw-HTML injection anywhere here (a test reads the source to keep it so),
  and free text gets `whitespace-pre-wrap break-words` so a long unbroken string
  cannot push the page sideways.
*/

const STATUS_TONE: Record<ReportStatus, string> = {
  NEW: 'border-saffron bg-saffron-soft text-saffron-ink',
  SEEN: 'border-rule-strong bg-chalk text-moss',
  FIXED: 'border-rule bg-chalk-sunk text-moss-700',
  WONTFIX: 'border-rule bg-chalk-sunk text-moss-muted',
};

export function isReportStatus(value: unknown): value is ReportStatus {
  return typeof value === 'string' && (REPORT_STATUSES as readonly string[]).includes(value);
}

export function isCauseCode(value: unknown): value is CauseCode {
  return typeof value === 'string' && (CAUSE_CODES as readonly string[]).includes(value);
}

export function ReportStatusChip({ status }: { status: ReportStatus }) {
  const t = useTranslations('bugReport.admin.statuses');
  return (
    <span
      className={cn(
        'inline-flex min-h-6 items-center rounded-full border px-2.5 text-[11px] font-bold uppercase tracking-wider',
        STATUS_TONE[status],
      )}
    >
      {t(status)}
    </span>
  );
}

/** The human label for a coded cause, with the code itself kept visible. */
export function CauseText({ code, prominent }: { code: string | null; prominent?: boolean }) {
  const t = useTranslations('bugReport.admin');
  if (!code) return <span className="text-moss-muted">{t('list.noCause')}</span>;
  const known = isCauseCode(code);
  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-2 gap-y-1', prominent && 'text-lg font-bold')}>
      <span>{known ? t(`causes.${code}`) : code}</span>
      <bdi dir="ltr" className="font-plexmono text-[12px] font-medium text-moss-muted">
        {code}
      </bdi>
    </span>
  );
}

export function ReportsStatusFilter({ active }: { active: ReportStatus | null }) {
  const t = useTranslations('bugReport.admin');
  const base = 'inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-semibold transition-colors';
  const on = 'border-moss bg-moss text-chalk';
  const off = 'border-rule bg-chalk-raised text-moss-muted hover:border-rule-strong hover:text-moss';
  return (
    <nav aria-label={t('filter.label')} className="flex flex-wrap items-center gap-2">
      <Link href="/admin/reports" aria-current={active === null ? 'page' : undefined} className={cn(base, active === null ? on : off)}>
        {t('filter.all')}
      </Link>
      {REPORT_STATUSES.map((status) => (
        <Link
          key={status}
          href={{ pathname: '/admin/reports', query: { status } }}
          aria-current={active === status ? 'page' : undefined}
          className={cn(base, active === status ? on : off)}
        >
          {t(`statuses.${status}`)}
        </Link>
      ))}
    </nav>
  );
}

export function ReportsGroupTable({ rows }: { rows: ReportGroupRow[] }) {
  const t = useTranslations('bugReport.admin.list');
  const format = useFormatter();

  if (rows.length === 0) return <p className="text-sm text-moss-muted">{t('empty')}</p>;

  const head = 'px-3 py-2 text-start text-[11px] font-bold uppercase tracking-widest text-moss-muted';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-rule">
            <th scope="col" className={head}>{t('status')}</th>
            <th scope="col" className={head}>{t('cause')}</th>
            <th scope="col" className={head}>{t('reports')}</th>
            <th scope="col" className={head}>{t('users')}</th>
            <th scope="col" className={head}>{t('lastSeen')}</th>
            <th scope="col" className={head}>{t('sample')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.fingerprint} className="border-b border-rule align-top last:border-b-0">
              <td className="px-3 py-3">
                <ReportStatusChip status={row.status} />
              </td>
              <td className="px-3 py-3 font-semibold text-moss">
                <CauseText code={row.topCause} />
              </td>
              <td className="px-3 py-3 tabular-nums">{format.number(row.count)}</td>
              <td className="px-3 py-3 tabular-nums">{format.number(row.distinctUsers)}</td>
              <td className="whitespace-nowrap px-3 py-3 text-moss-muted">
                {format.dateTime(new Date(row.lastSeen), { dateStyle: 'medium', timeStyle: 'short' })}
              </td>
              <td className="max-w-sm px-3 py-3">
                <Link
                  href={{ pathname: '/admin/reports/[ref]', params: { ref: row.sampleRef } }}
                  className="inline-flex min-h-8 items-center font-plexmono text-[13px] font-semibold text-moss underline-offset-2 hover:underline"
                >
                  <bdi dir="ltr">{row.sampleRef}</bdi>
                </Link>
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-words text-moss-muted">
                  {row.sampleMessage ?? t('noMessage')}
                </p>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SOURCE_STYLE: Record<TimelineItem['source'], { icon: LucideIcon; tone: string }> = {
  client: { icon: Monitor, tone: 'border-rule-strong bg-chalk text-moss' },
  activity: { icon: Activity, tone: 'border-rule bg-chalk-sunk text-moss-700' },
  run: { icon: PlayCircle, tone: 'border-saffron bg-saffron-soft text-saffron-ink' },
  ai_provider: { icon: Bot, tone: 'border-forest-line bg-forest text-chalk' },
  publish: { icon: Send, tone: 'border-moss bg-moss text-chalk' },
};

/** Oldest first, one vertical rail. The source is named in text as well as colour. */
export function ReportTimeline({ items }: { items: TimelineItem[] }) {
  const t = useTranslations('bugReport.admin');
  const format = useFormatter();

  if (items.length === 0) return <p className="text-sm text-moss-muted">{t('detail.timelineEmpty')}</p>;

  return (
    <ol className="ms-4 border-s border-rule-strong">
      {items.map((item, index) => {
        const style = SOURCE_STYLE[item.source] ?? SOURCE_STYLE.client;
        const Icon = style.icon;
        return (
          <li key={`${item.t}-${index}`} className="relative pb-5 ps-7 last:pb-0">
            <span
              aria-hidden
              className={cn(
                'absolute -start-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border',
                style.tone,
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">
                {t(`source.${item.source}`)}
              </span>
              <time dateTime={new Date(item.t).toISOString()} className="text-[12px] tabular-nums text-moss-muted">
                {format.dateTime(new Date(item.t), { dateStyle: 'short', timeStyle: 'medium' })}
              </time>
            </div>
            <p className="mt-0.5 whitespace-pre-wrap break-words font-plexmono text-[13px] font-medium text-moss">
              <bdi dir="ltr">{item.label}</bdi>
            </p>
            {item.code ? (
              <p className="mt-1 text-sm font-semibold text-red-800">
                <CauseText code={item.code} />
              </p>
            ) : null}
            {item.refId ? (
              <p className="mt-0.5 break-all font-plexmono text-[11px] text-moss-muted">
                <bdi dir="ltr">{item.refId}</bdi>
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

const SENTRY_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/i;
const SENTRY_EVENT = /^[0-9a-f]{32}$/i;

/** Link to Sentry only when the org slug is configured and the id is a real event id. */
export function sentryUrl(eventId: string, orgSlug: string | undefined): string | null {
  if (!orgSlug || !SENTRY_SLUG.test(orgSlug) || !SENTRY_EVENT.test(eventId)) return null;
  return `https://sentry.io/organizations/${orgSlug}/issues/?query=${eventId}`;
}

export function SentryEventId({ eventId }: { eventId: string | null }) {
  const t = useTranslations('bugReport.admin.detail');
  if (!eventId) return <span className="text-moss-muted">{t('unknown')}</span>;
  const url = sentryUrl(eventId, process.env.NEXT_PUBLIC_SENTRY_ORG_SLUG);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <RefChip value={eventId} copyLabel={t('copy')} copiedLabel={t('copied')} className="max-w-full break-all" />
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-10 items-center text-sm font-semibold text-moss underline underline-offset-2"
        >
          {t('sentryOpen')}
        </a>
      ) : null}
    </div>
  );
}

/** `action` is a server action supplied by the page, so this stays a plain form. */
export function ReportStatusForm({
  referenceCode,
  current,
  action,
}: {
  referenceCode: string;
  current: ReportStatus;
  action: (formData: FormData) => void | Promise<void>;
}) {
  const t = useTranslations('bugReport.admin');
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="referenceCode" value={referenceCode} />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium text-moss">
          {t('form.title')}
          <select
            name="status"
            defaultValue={current}
            className="min-h-11 rounded-lg border border-rule-strong bg-chalk px-3 text-sm text-moss"
          >
            {REPORT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`statuses.${status}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-lg bg-moss px-5 text-sm font-semibold text-chalk transition-colors hover:bg-moss-700"
        >
          {t('form.submit')}
        </button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm text-moss">
        <input type="checkbox" name="applyToGroup" value="true" className="h-4 w-4 accent-moss" />
        {t('form.apply')}
      </label>
    </form>
  );
}

export function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">{label}</dt>
      <dd className="min-w-0 break-words text-sm font-medium text-moss">{children}</dd>
    </div>
  );
}
