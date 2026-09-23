import type { ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';

/**
 * next-intl's formatter, as the hook hands it back. `Formatter` is not exported
 * under that name, and inferring it here keeps these helpers honest if the
 * library's shape ever changes.
 */
type Formatter = ReturnType<typeof useFormatter>;

/** The subset of a namespace translator these helpers need. */
type UnitTranslator = (key: string, values?: Record<string, string | number | Date>) => string;

/**
 * Number, money, date and duration formatting for the admin console.
 *
 * Every number on these screens is data — a cost, a token count, a balance —
 * so none of it is written into a message string. It goes through the
 * request's formatter instead, which is what makes `1,204` come back as
 * `۱٬۲۰۴` and a timestamp come back on the Persian calendar in Tehran time
 * without a single per-locale branch in a component.
 *
 * Pages build one of these with `getFormatter()` + `getTranslations('admin')`
 * and pass it down; the plain functions cannot call hooks themselves.
 */
export type AdminFormat = {
  number: (value: number | bigint | null | undefined) => string;
  decimal: (value: number | null | undefined, fractionDigits?: number) => string;
  usd: (value: number) => string;
  dateTime: (value: Date | string | null | undefined) => string;
  duration: (value: number | null | undefined) => string;
};

export function createAdminFormat(format: Formatter, t: UnitTranslator): AdminFormat {
  const number: AdminFormat['number'] = (value) => {
    if (value == null) return '-';
    return format.number(value);
  };

  return {
    number,
    decimal: (value, fractionDigits = 2) => {
      if (value == null || Number.isNaN(value)) return '-';
      return format.number(value, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
    },
    usd: (value) =>
      format.number(value, {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      }),
    dateTime: (value) => {
      if (!value) return '-';
      return format.dateTime(new Date(value), { dateStyle: 'medium', timeStyle: 'short' });
    },
    duration: (value) => {
      if (!value || value <= 0) return '-';
      if (value < 1000) return t('units.milliseconds', { value: format.number(value) });
      return t('units.seconds', {
        value: format.number(value / 1000, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      });
    },
  };
}

export function getStatusTone(status: string): string {
  if (['FAILED', 'ERROR', 'PAST_DUE', 'INCOMPLETE'].includes(status)) {
    return 'text-red-700 bg-red-50 border-red-200';
  }
  if (['PENDING', 'RUNNING', 'CRAWLING', 'ANALYZING', 'TRIALING', 'warning'].includes(status)) {
    return 'text-amber-700 bg-amber-50 border-amber-200';
  }
  if (['SCHEDULED', 'PUBLISHED', 'READY', 'ACTIVE', 'COMPLETED', 'healthy'].includes(status)) {
    return 'text-emerald-700 bg-emerald-50 border-emerald-200';
  }
  return 'text-slate-700 bg-slate-50 border-slate-200';
}

export function PageHeader({
  title,
  subtitle,
  backHref,
  backLabel,
  actions,
}: {
  title: string;
  subtitle?: string;
  backHref: string;
  backLabel: string;
  actions?: ReactNode;
}) {
  return (
    <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white via-white to-slate-50 p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <a href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition hover:text-black">
            {/* The arrow points back the way the reader came, so it flips with the page. */}
            <span aria-hidden className="inline-block rtl:rotate-180">←</span>
            {backLabel}
          </a>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-[#121212]">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <p className="text-base font-bold text-[#121212]">{title}</p>
        {subtitle ? <p className="mt-1 text-sm text-slate-500">{subtitle}</p> : null}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

export function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper?: string;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-[#121212]">{value}</p>
      {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
    </div>
  );
}

export function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-bold text-[#121212]">{value}</p>
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getStatusTone(status)}`}>
      {status}
    </span>
  );
}

export function EmptyState({ text }: { text: string }) {
  return <p className="text-sm text-slate-500">{text}</p>;
}

export function KeyValueGrid({
  items,
  columns = 2,
}: {
  items: Array<{ label: string; value: ReactNode }>;
  columns?: 2 | 3 | 4;
}) {
  const className =
    columns === 4
      ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-4'
      : columns === 3
        ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3'
        : 'grid gap-4 md:grid-cols-2';

  return (
    <div className={className}>
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-500">{item.label}</p>
          <div className="mt-2 text-sm font-medium text-[#121212]">{item.value}</div>
        </div>
      ))}
    </div>
  );
}

export function LogList({
  rows,
}: {
  rows: Array<{ id: string; action: string; workspaceName: string | null; detail: unknown; createdAt: Date }>;
}) {
  const t = useTranslations('admin');
  const format = useFormatter();

  if (!rows.length) {
    return <EmptyState text={t('common.noLogEntries')} />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            {/* Audit action codes are stored values, so they stay Latin and LTR. */}
            <p className="text-sm font-bold text-[#121212]" dir="ltr">{row.action}</p>
            <p className="text-[11px] text-slate-400">
              {format.dateTime(new Date(row.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <p className="mt-1 text-xs text-slate-500">{row.workspaceName || t('common.noWorkspace')}</p>
          <pre dir="ltr" className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-2 text-start text-[11px] text-slate-600">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
