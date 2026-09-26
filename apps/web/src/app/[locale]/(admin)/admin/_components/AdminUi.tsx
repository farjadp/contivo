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
    return 'text-moss-700 bg-chalk-sunk border-rule';
  }
  return 'text-moss bg-chalk border-rule';
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
    <div className="rounded-3xl border border-rule bg-gradient-to-br from-chalk-raised via-chalk-raised to-chalk p-6 shadow-sm">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <a href={backHref} className="inline-flex items-center gap-1.5 text-sm font-medium text-moss-muted transition hover:text-moss">
            {/* The arrow points back the way the reader came, so it flips with the page. */}
            <span aria-hidden className="inline-block rtl:rotate-180">←</span>
            {backLabel}
          </a>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-moss">{title}</h1>
          {subtitle ? <p className="mt-2 max-w-3xl text-sm leading-6 text-moss-muted">{subtitle}</p> : null}
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
    <div className="rounded-2xl border border-rule bg-chalk-raised shadow-sm">
      <div className="border-b border-rule px-5 py-4">
        <p className="text-base font-bold text-moss">{title}</p>
        {subtitle ? <p className="mt-1 text-sm text-moss-muted">{subtitle}</p> : null}
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
    <div className="rounded-2xl border border-rule bg-chalk-raised p-4">
      <p className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">{label}</p>
      <p className="mt-2 text-2xl font-bold text-moss">{value}</p>
      {helper ? <p className="mt-1 text-xs text-moss-muted">{helper}</p> : null}
    </div>
  );
}

export function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-rule bg-chalk px-3 py-2">
      <p className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">{label}</p>
      <p className="mt-1 text-sm font-bold text-moss">{value}</p>
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
  return <p className="text-sm text-moss-muted">{text}</p>;
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
        <div key={item.label} className="rounded-xl border border-rule bg-chalk p-3">
          <p className="text-[11px] font-bold uppercase tracking-widest text-moss-muted">{item.label}</p>
          <div className="mt-2 text-sm font-medium text-moss">{item.value}</div>
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
        <div key={row.id} className="rounded-xl border border-rule bg-chalk p-3">
          <div className="flex items-center justify-between gap-3">
            {/* Audit action codes are stored values, so they stay Latin and LTR. */}
            <p className="text-sm font-bold text-moss" dir="ltr">{row.action}</p>
            <p className="text-[11px] text-moss-muted">
              {format.dateTime(new Date(row.createdAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </p>
          </div>
          <p className="mt-1 text-xs text-moss-muted">{row.workspaceName || t('common.noWorkspace')}</p>
          <pre dir="ltr" className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-rule bg-chalk-raised p-2 text-start text-[11px] text-moss-muted">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
