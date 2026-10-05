import { describe, expect, it } from 'vitest';
import { generateMockBilling } from '../../../scripts/billing-mock/generate.mjs';
import { computeFinance, type FinanceInvoice, type FinanceSubscription } from './metrics';
import { ledgerRecordFromStripe, type InvoiceRow, type OneOffRow, type RefundRow } from './stripe-records';

const NOW = new Date('2026-10-05T18:00:00Z');
const STATUS: Record<string, FinanceSubscription['status']> = { active: 'ACTIVE', past_due: 'PAST_DUE', canceled: 'CANCELED' };

function fromMock(seed: number) {
  // The generator is plain JS; its inferred types are too loose to be useful here.
  const mock = generateMockBilling(seed) as any;
  const records = [...mock.invoices, ...mock.sessions, ...mock.refunds].map((o: object) => ledgerRecordFromStripe(o, 'MOCK'));
  const invoices = records.filter((r) => r?.kind === 'invoice').map((r) => r!.row as InvoiceRow);
  const oneOffs = records.filter((r) => r?.kind === 'oneOff').map((r) => r!.row as OneOffRow);
  const refunds = records.filter((r) => r?.kind === 'refund').map((r) => r!.row as RefundRow);
  const subscriptions = mock.subscriptions.map((s: any) => ({ stripeSubscriptionId: s.id, status: STATUS[s.status] }));
  return { mock, invoices: invoices as FinanceInvoice[], oneOffs, refunds, subscriptions };
}

describe('computeFinance against the mock history', () => {
  const { mock, invoices, oneOffs, refunds, subscriptions } = fromMock(9);
  const f = computeFinance({ invoices, oneOffs, refunds, subscriptions, now: NOW });
  const cents = (usd: number) => Math.round(usd * 100);

  it('keeps every Stripe object the ledger should keep', () => {
    expect(invoices).toHaveLength(mock.invoices.length);
    expect(oneOffs).toHaveLength(mock.sessions.length);
    expect(refunds).toHaveLength(mock.refunds.length);
  });

  it('adds gross, refunds and net up to the generator’s own tally', () => {
    expect(f.totals.gross).toBe(cents(mock.summary.totals_usd.gross_collected));
    expect(f.totals.refunds).toBe(cents(mock.summary.totals_usd.refunded));
    expect(f.totals.net).toBe(cents(mock.summary.totals_usd.net));
  });

  it('splits revenue and new customers by month the same way', () => {
    for (const [month, m] of Object.entries(mock.summary.by_month_usd) as Array<[string, any]>) {
      const row = f.months.find((x) => x.month === month)!;
      expect(row.gross).toBe(cents(m.gross));
      expect(row.refunds).toBe(cents(m.refunds));
      expect(row.newCustomers).toBe(m.new_customers);
    }
  });

  it('puts MRR within a cent per subscription of the generator’s figure', () => {
    expect(Math.abs(f.mrr - cents(mock.summary.mrr_usd_now))).toBeLessThanOrEqual(subscriptions.length);
  });

  it('lists every failed invoice that was never collected', () => {
    expect(f.needsAttention.map((i) => i.stripeInvoiceId).sort()).toEqual(
      mock.invoices.filter((i: any) => i.status === 'uncollectible').map((i: any) => i.id).sort(),
    );
  });
});

describe('computeFinance edge cases', () => {
  const inv = (over: Partial<FinanceInvoice>): FinanceInvoice => ({
    stripeInvoiceId: 'in_1', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'PAID', plan: 'PRO',
    interval: 'month', amountDue: 8900, amountPaid: 8900, periodEnd: new Date('2026-09-15Z'), issuedAt: new Date('2026-08-15Z'), ...over,
  });

  it('counts an annual plan as a twelfth of its price in MRR', () => {
    const f = computeFinance({ invoices: [inv({ interval: 'year', amountDue: 89000, amountPaid: 89000 })], oneOffs: [], refunds: [], subscriptions: [{ stripeSubscriptionId: 'sub_1', status: 'ACTIVE' }], now: NOW });
    expect(f.mrr).toBe(7417);
  });

  it('leaves canceled subscriptions out of MRR and counts the churn in the month their period ended', () => {
    const f = computeFinance({ invoices: [inv({})], oneOffs: [], refunds: [], subscriptions: [{ stripeSubscriptionId: 'sub_1', status: 'CANCELED' }], now: NOW });
    expect(f.mrr).toBe(0);
    expect(f.months.find((m) => m.month === '2026-09')!.churned).toBe(1);
  });

  it('uses the latest invoice after an upgrade', () => {
    const f = computeFinance({
      invoices: [inv({ plan: 'STARTER', amountDue: 5500, amountPaid: 5500 }), inv({ stripeInvoiceId: 'in_2', issuedAt: new Date('2026-09-15Z'), periodEnd: new Date('2026-10-15Z') })],
      oneOffs: [], refunds: [], subscriptions: [{ stripeSubscriptionId: 'sub_1', status: 'ACTIVE' }], now: NOW,
    });
    expect(f.mrr).toBe(8900);
    expect(f.byPlan).toEqual([{ plan: 'PRO', subscriptions: 1, mrr: 8900 }]);
  });

  it('returns zeros for an empty ledger', () => {
    const f = computeFinance({ invoices: [], oneOffs: [], refunds: [], subscriptions: [], now: NOW });
    expect(f).toMatchObject({ mrr: 0, totals: { gross: 0, refunds: 0, net: 0 }, payingCustomers: 0, needsAttention: [] });
  });
});

describe('ledgerRecordFromStripe', () => {
  it('skips drafts, unpaid sessions and failed refunds', () => {
    expect(ledgerRecordFromStripe({ object: 'invoice', status: 'draft', customer: 'cus_1', created: 1 })).toBeNull();
    expect(ledgerRecordFromStripe({ object: 'checkout.session', mode: 'payment', payment_status: 'unpaid', customer: 'cus_1', created: 1 })).toBeNull();
    expect(ledgerRecordFromStripe({ object: 'checkout.session', mode: 'subscription', payment_status: 'paid', customer: 'cus_1', created: 1 })).toBeNull();
    expect(ledgerRecordFromStripe({ object: 'refund', status: 'failed', created: 1 })).toBeNull();
  });

  it('reads the plan from the price id when metadata has none', () => {
    const r = ledgerRecordFromStripe({ object: 'invoice', id: 'in_9', status: 'paid', customer: { id: 'cus_9' }, created: 1_760_000_000, lines: { data: [{ price: { id: 'price_live_agency_year', recurring: { interval: 'year' } } }] } });
    expect(r).toMatchObject({ kind: 'invoice', row: { plan: 'AGENCY', interval: 'year', stripeCustomerId: 'cus_9', source: 'STRIPE' } });
  });
});
