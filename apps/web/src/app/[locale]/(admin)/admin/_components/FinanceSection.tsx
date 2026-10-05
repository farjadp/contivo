import { useFormatter, useTranslations } from 'next-intl';

import type { AdminFinance } from '@/lib/finance/ledger';
import { AdminBarChart } from '../charts';
import { EmptyState, MetricCard, Panel, StatusBadge } from './AdminUi';

const REASONS = new Set(['subscription_create', 'subscription_cycle', 'subscription_update']);

/**
 * The founder's view of the money: what recurs, what came in each month, who
 * churned and which payments need chasing. Every figure is computed from the
 * billing ledger by computeFinance; this component only lays it out.
 */
export function FinanceSection({ finance }: { finance: AdminFinance }) {
  const t = useTranslations('admin');
  const format = useFormatter();
  const money = (cents: number) =>
    format.number(cents / 100, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    });
  // Months are bucketed on the Gregorian calendar, as Stripe bills, so they are
  // labelled on it too: in Persian a "Mordad" label would cover 10 Mordad to 9 Shahrivar.
  const monthLabel = (month: string) =>
    format.dateTime(new Date(`${month}-01T00:00:00Z`), {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
      calendar: 'gregory',
    });
  const day = (d: Date) => format.dateTime(new Date(d), { dateStyle: 'medium' });
  const who = (customer: string | null) =>
    customer ? (finance.emailByCustomer[customer] ?? customer) : '-';

  const current = finance.months.at(-1);
  const chart = finance.months.map((m) => ({ month: monthLabel(m.month), net: m.net / 100 }));

  if (finance.totals.gross === 0 && finance.recentInvoices.length === 0) {
    return <EmptyState text={t('finance.empty')} />;
  }

  return (
    <div className="space-y-4">
      {finance.hasMockData ? (
        <div
          role="note"
          className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800"
        >
          {t('finance.mockBanner')}
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={t('finance.kpiMrr')}
          value={money(finance.mrr)}
          helper={t('finance.kpiMrrHelper')}
        />
        <MetricCard
          label={t('finance.kpiNet')}
          value={money(finance.totals.net)}
          helper={t('finance.kpiNetHelper', {
            gross: money(finance.totals.gross),
            refunds: money(finance.totals.refunds),
          })}
        />
        <MetricCard label={t('finance.kpiPaying')} value={format.number(finance.payingCustomers)} />
        <MetricCard
          label={t('finance.kpiChurned')}
          value={format.number(finance.churnedThisMonth)}
          helper={current ? monthLabel(current.month) : undefined}
        />
        <MetricCard
          label={t('finance.kpiAttention')}
          value={format.number(finance.needsAttention.length)}
          helper={
            finance.needsAttention.length
              ? money(finance.needsAttention.reduce((s, i) => s + i.amountDue - i.amountPaid, 0))
              : undefined
          }
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr] [&>*]:min-w-0">
        <Panel title={t('finance.byMonthTitle')} subtitle={t('finance.byMonthSubtitle')}>
          <AdminBarChart
            data={chart}
            dataKey="net"
            nameKey="month"
            color="#2F4A3A"
            valueName={t('finance.colNet')}
          />
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-xs uppercase tracking-wider text-moss-muted">
                  <th className="px-3 py-2 text-start">{t('finance.colMonth')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colGross')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colRefunds')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colNet')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colNew')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colChurned')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {finance.months.map((m) => (
                  <tr key={m.month} className="border-b border-rule">
                    <td className="px-3 py-2 font-medium text-moss">{monthLabel(m.month)}</td>
                    <td className="px-3 py-2 text-end">{money(m.gross)}</td>
                    <td className="px-3 py-2 text-end text-red-700">
                      {m.refunds ? money(-m.refunds) : '-'}
                    </td>
                    <td className="px-3 py-2 text-end font-bold text-moss">{money(m.net)}</td>
                    <td className="px-3 py-2 text-end">{format.number(m.newCustomers)}</td>
                    <td className="px-3 py-2 text-end">{format.number(m.churned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={t('finance.byPlanTitle')} subtitle={t('finance.byPlanSubtitle')}>
          {finance.byPlan.length ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-xs uppercase tracking-wider text-moss-muted">
                    <th className="px-3 py-2 text-start">{t('finance.colPlan')}</th>
                    <th className="px-3 py-2 text-end">{t('finance.colSubscriptions')}</th>
                    <th className="px-3 py-2 text-end">{t('finance.kpiMrr')}</th>
                    <th className="px-3 py-2 text-end">{t('finance.colShare')}</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {finance.byPlan.map((p) => (
                    <tr key={p.plan} className="border-b border-rule">
                      <td className="px-3 py-2 font-medium text-moss">{p.plan}</td>
                      <td className="px-3 py-2 text-end">{format.number(p.subscriptions)}</td>
                      <td className="px-3 py-2 text-end font-bold">{money(p.mrr)}</td>
                      <td className="px-3 py-2 text-end">
                        {format.number(finance.mrr ? p.mrr / finance.mrr : 0, {
                          style: 'percent',
                          maximumFractionDigits: 0,
                        })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState text={t('finance.noSubscriptions')} />
          )}
        </Panel>
      </div>

      <Panel title={t('finance.attentionTitle')} subtitle={t('finance.attentionSubtitle')}>
        {finance.needsAttention.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-xs uppercase tracking-wider text-moss-muted">
                  <th className="px-3 py-2 text-start">{t('finance.colCustomer')}</th>
                  <th className="px-3 py-2 text-start">{t('finance.colStatus')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colOwed')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colAttempts')}</th>
                  <th className="px-3 py-2 text-start">{t('finance.colIssued')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {finance.needsAttention.map((i) => (
                  <tr key={i.stripeInvoiceId} className="border-b border-rule">
                    <td className="px-3 py-2">
                      <bdi>{who(i.stripeCustomerId)}</bdi>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-2 text-end font-bold text-red-700">
                      {money(i.amountDue - i.amountPaid)}
                    </td>
                    <td className="px-3 py-2 text-end">{format.number(i.attemptCount ?? 1)}</td>
                    <td className="px-3 py-2">{day(i.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState text={t('finance.noAttention')} />
        )}
      </Panel>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_0.6fr] [&>*]:min-w-0">
        <Panel title={t('finance.invoicesTitle')} subtitle={t('finance.invoicesSubtitle')}>
          <div className="max-h-[520px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-rule text-xs uppercase tracking-wider text-moss-muted">
                  <th className="px-3 py-2 text-start">{t('finance.colCustomer')}</th>
                  <th className="px-3 py-2 text-start">{t('finance.colPlan')}</th>
                  <th className="px-3 py-2 text-start">{t('finance.colReason')}</th>
                  <th className="px-3 py-2 text-start">{t('finance.colStatus')}</th>
                  <th className="px-3 py-2 text-end">{t('finance.colPaid')}</th>
                  <th className="px-3 py-2 text-start">{t('finance.colIssued')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {finance.recentInvoices.map((i) => (
                  <tr key={i.id} className="border-b border-rule">
                    <td className="px-3 py-2">
                      <bdi>{who(i.stripeCustomerId)}</bdi>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {i.plan ?? '-'} ·{' '}
                      {t(i.interval === 'year' ? 'finance.annual' : 'finance.monthly')}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {t(
                        `finance.reason.${REASONS.has(i.billingReason) ? i.billingReason : 'other'}` as never,
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={i.status} />
                    </td>
                    <td className="px-3 py-2 text-end font-bold">{money(i.amountPaid)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{day(i.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title={t('finance.refundsTitle')} subtitle={t('finance.refundsSubtitle')}>
          {finance.recentRefunds.length ? (
            <ul className="space-y-3 text-sm">
              {finance.recentRefunds.map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-3 border-b border-rule pb-3"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-moss">
                      <bdi>{who(r.stripeCustomerId)}</bdi>
                    </p>
                    <p className="text-xs text-moss-muted">{day(r.refundedAt)}</p>
                  </div>
                  <p className="font-bold tabular-nums text-red-700">{money(-r.amount)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState text={t('finance.noRefunds')} />
          )}
        </Panel>
      </div>
    </div>
  );
}
