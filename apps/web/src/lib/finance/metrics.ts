// Finance numbers for the admin console, computed from billing ledger rows.
// Pure: the page loads rows, this turns them into the figures the spec defines
// (docs/superpowers/specs/2026-10-05-admin-finance-design.md). All money is
// integer cents.

export type FinanceInvoice = {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: 'PAID' | 'OPEN' | 'UNCOLLECTIBLE' | 'VOID';
  plan: string | null;
  interval: string;
  amountDue: number;
  amountPaid: number;
  attemptCount?: number;
  periodEnd: Date;
  issuedAt: Date;
};
export type FinanceOneOff = { amount: number; paidAt: Date };
export type FinanceRefund = { amount: number; refundedAt: Date };
export type FinanceSubscription = {
  stripeSubscriptionId: string | null;
  status: 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'TRIALING' | 'INCOMPLETE';
};

export type FinanceMonth = {
  month: string; // YYYY-MM, UTC
  gross: number;
  refunds: number;
  net: number;
  newCustomers: number;
  churned: number;
};

export type FinanceSummary = {
  mrr: number;
  totals: { gross: number; refunds: number; net: number };
  payingCustomers: number;
  churnedThisMonth: number;
  months: FinanceMonth[];
  byPlan: Array<{ plan: string; subscriptions: number; mrr: number }>;
  needsAttention: FinanceInvoice[];
};

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const LIVE = new Set(['ACTIVE', 'PAST_DUE']);

function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1);
  while (cursor.getTime() <= end) {
    out.push(monthKey(cursor));
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

/** What one invoice is worth per month: annual invoices count a twelfth. */
export const monthlyValue = (invoice: Pick<FinanceInvoice, 'amountDue' | 'interval'>) =>
  invoice.interval === 'year' ? Math.round(invoice.amountDue / 12) : invoice.amountDue;

export function computeFinance(input: {
  invoices: FinanceInvoice[];
  oneOffs: FinanceOneOff[];
  refunds: FinanceRefund[];
  subscriptions: FinanceSubscription[];
  now: Date;
}): FinanceSummary {
  const { invoices, oneOffs, refunds, subscriptions, now } = input;

  // Latest invoice per subscription decides its price and plan today.
  const latestBySub = new Map<string, FinanceInvoice>();
  const lastPeriodEndBySub = new Map<string, Date>();
  for (const inv of invoices) {
    if (!inv.stripeSubscriptionId || inv.status === 'VOID') continue;
    const prev = latestBySub.get(inv.stripeSubscriptionId);
    if (!prev || inv.issuedAt > prev.issuedAt) latestBySub.set(inv.stripeSubscriptionId, inv);
    const end = lastPeriodEndBySub.get(inv.stripeSubscriptionId);
    if (!end || inv.periodEnd > end) lastPeriodEndBySub.set(inv.stripeSubscriptionId, inv.periodEnd);
  }

  const statusBySub = new Map(subscriptions.filter((s) => s.stripeSubscriptionId).map((s) => [s.stripeSubscriptionId as string, s.status]));
  let mrr = 0;
  const plan = new Map<string, { subscriptions: number; mrr: number }>();
  for (const [subId, inv] of latestBySub) {
    if (!LIVE.has(statusBySub.get(subId) ?? '')) continue;
    const value = monthlyValue(inv);
    mrr += value;
    const key = inv.plan ?? 'UNKNOWN';
    const entry = plan.get(key) ?? { subscriptions: 0, mrr: 0 };
    entry.subscriptions += 1;
    entry.mrr += value;
    plan.set(key, entry);
  }

  const dates = [...invoices.map((i) => i.issuedAt), ...oneOffs.map((o) => o.paidAt), ...refunds.map((r) => r.refundedAt)];
  const first = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : now;
  const months = new Map<string, FinanceMonth>(
    monthsBetween(first, now).map((m) => [m, { month: m, gross: 0, refunds: 0, net: 0, newCustomers: 0, churned: 0 }]),
  );
  const bump = (d: Date, field: 'gross' | 'refunds' | 'newCustomers' | 'churned', by: number) => {
    const m = months.get(monthKey(d));
    if (m) m[field] += by;
  };

  const firstPaidByCustomer = new Map<string, Date>();
  for (const inv of invoices) {
    if (inv.amountPaid > 0) {
      bump(inv.issuedAt, 'gross', inv.amountPaid);
      const seen = firstPaidByCustomer.get(inv.stripeCustomerId);
      if (!seen || inv.issuedAt < seen) firstPaidByCustomer.set(inv.stripeCustomerId, inv.issuedAt);
    }
  }
  for (const o of oneOffs) bump(o.paidAt, 'gross', o.amount);
  for (const r of refunds) bump(r.refundedAt, 'refunds', r.amount);
  for (const d of firstPaidByCustomer.values()) bump(d, 'newCustomers', 1);
  for (const [subId, status] of statusBySub) {
    const end = lastPeriodEndBySub.get(subId);
    if (status === 'CANCELED' && end && end <= now) bump(end, 'churned', 1);
  }
  for (const m of months.values()) m.net = m.gross - m.refunds;

  const monthList = [...months.values()];
  const gross = monthList.reduce((s, m) => s + m.gross, 0);
  const refunded = monthList.reduce((s, m) => s + m.refunds, 0);
  const payingSubs = [...latestBySub.keys()].filter((id) => LIVE.has(statusBySub.get(id) ?? ''));

  return {
    mrr,
    totals: { gross, refunds: refunded, net: gross - refunded },
    payingCustomers: new Set(payingSubs.map((id) => latestBySub.get(id)!.stripeCustomerId)).size,
    churnedThisMonth: months.get(monthKey(now))?.churned ?? 0,
    months: monthList,
    byPlan: [...plan.entries()].map(([p, v]) => ({ plan: p, ...v })).sort((a, b) => b.mrr - a.mrr),
    needsAttention: invoices
      .filter((i) => i.status === 'OPEN' || i.status === 'UNCOLLECTIBLE')
      .sort((a, b) => b.issuedAt.getTime() - a.issuedAt.getTime()),
  };
}
