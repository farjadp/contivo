import type { ReactNode } from 'react';

export function formatUsd(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '-';
  return new Date(value).toLocaleString();
}

export function formatDuration(value: number | null | undefined): string {
  if (!value || value <= 0) return '-';
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
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
          <a href={backHref} className="text-sm font-medium text-slate-500 transition hover:text-black">
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
  if (!rows.length) {
    return <EmptyState text="No log entries recorded." />;
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-gray-200 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-bold text-[#121212]">{row.action}</p>
            <p className="text-[11px] text-slate-400">{formatDateTime(row.createdAt)}</p>
          </div>
          <p className="mt-1 text-xs text-slate-500">{row.workspaceName || 'No workspace'}</p>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-white p-2 text-[11px] text-slate-600">
            {JSON.stringify(row.detail, null, 2)}
          </pre>
        </div>
      ))}
    </div>
  );
}
