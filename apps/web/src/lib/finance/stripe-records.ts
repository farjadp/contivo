// Stripe objects → billing ledger rows. Pure, with no imports, so the mock
// importer can load this file directly with Node's type stripping and the
// Stripe webhook (branch pricing-packages) can share the exact same mapping.

export type LedgerSource = 'STRIPE' | 'MOCK';
export type LedgerPlan = 'FREE' | 'STARTER' | 'PRO' | 'AGENCY';
export type LedgerInvoiceStatus = 'PAID' | 'OPEN' | 'UNCOLLECTIBLE' | 'VOID';

export type InvoiceRow = {
  stripeInvoiceId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  status: LedgerInvoiceStatus;
  billingReason: string;
  plan: LedgerPlan | null;
  interval: 'month' | 'year';
  currency: string;
  amountDue: number;
  amountPaid: number;
  attemptCount: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  paidAt: Date | null;
  source: LedgerSource;
};

export type OneOffRow = {
  stripeSessionId: string;
  stripeCustomerId: string;
  kind: string;
  amount: number;
  currency: string;
  paidAt: Date;
  source: LedgerSource;
};

export type RefundRow = {
  stripeRefundId: string;
  stripeInvoiceId: string | null;
  stripeCustomerId: string | null;
  amount: number;
  currency: string;
  reason: string | null;
  refundedAt: Date;
  source: LedgerSource;
};

export type LedgerRecord =
  | { kind: 'invoice'; row: InvoiceRow }
  | { kind: 'oneOff'; row: OneOffRow }
  | { kind: 'refund'; row: RefundRow };

type StripeLike = Record<string, any>;

const PLANS: readonly LedgerPlan[] = ['FREE', 'STARTER', 'PRO', 'AGENCY'];
const fromUnix = (seconds: number | null | undefined): Date | null =>
  typeof seconds === 'number' ? new Date(seconds * 1000) : null;
const customerId = (value: unknown): string | null =>
  typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String((value as StripeLike).id) : null;

function planOf(invoice: StripeLike): LedgerPlan | null {
  const fromMeta = String(invoice.metadata?.plan ?? '').toUpperCase();
  if ((PLANS as readonly string[]).includes(fromMeta)) return fromMeta as LedgerPlan;
  // Price ids follow price_<plan>_<interval> in this project, e.g. price_test_pro_month.
  const priceId = String(invoice.lines?.data?.[0]?.price?.id ?? '');
  return PLANS.find((p) => priceId.toLowerCase().includes(`_${p.toLowerCase()}_`)) ?? null;
}

function invoiceStatus(invoice: StripeLike): LedgerInvoiceStatus | null {
  switch (invoice.status) {
    case 'paid': return 'PAID';
    case 'open': return 'OPEN';
    case 'uncollectible': return 'UNCOLLECTIBLE';
    case 'void': return 'VOID';
    default: return null; // drafts are not money yet
  }
}

/**
 * Map one Stripe object (an invoice, a payment-mode Checkout Session or a
 * refund) to a ledger row. Returns null for anything the ledger does not keep:
 * draft invoices, unpaid sessions, subscription-mode sessions, failed refunds.
 */
export function ledgerRecordFromStripe(object: StripeLike, source: LedgerSource = 'STRIPE'): LedgerRecord | null {
  if (object?.object === 'invoice') {
    const status = invoiceStatus(object);
    const customer = customerId(object.customer);
    const issuedAt = fromUnix(object.created);
    if (!status || !customer || !issuedAt) return null;
    const line = object.lines?.data?.[0];
    return {
      kind: 'invoice',
      row: {
        stripeInvoiceId: String(object.id),
        stripeCustomerId: customer,
        stripeSubscriptionId: typeof object.subscription === 'string' ? object.subscription : object.subscription?.id ?? null,
        status,
        billingReason: String(object.billing_reason ?? 'manual'),
        plan: planOf(object),
        interval: line?.price?.recurring?.interval === 'year' ? 'year' : 'month',
        currency: String(object.currency ?? 'usd'),
        amountDue: Number(object.amount_due ?? 0),
        amountPaid: Number(object.amount_paid ?? 0),
        attemptCount: Number(object.attempt_count ?? 1),
        periodStart: fromUnix(object.period_start) ?? issuedAt,
        periodEnd: fromUnix(object.period_end) ?? issuedAt,
        issuedAt,
        paidAt: fromUnix(object.status_transitions?.paid_at),
        source,
      },
    };
  }

  if (object?.object === 'checkout.session') {
    const customer = customerId(object.customer);
    const paidAt = fromUnix(object.created);
    if (object.mode !== 'payment' || object.payment_status !== 'paid' || !customer || !paidAt) return null;
    return {
      kind: 'oneOff',
      row: {
        stripeSessionId: String(object.id),
        stripeCustomerId: customer,
        kind: String(object.metadata?.kind ?? 'ONE_OFF'),
        amount: Number(object.amount_total ?? 0),
        currency: String(object.currency ?? 'usd'),
        paidAt,
        source,
      },
    };
  }

  if (object?.object === 'refund') {
    const refundedAt = fromUnix(object.created);
    if (object.status !== 'succeeded' || !refundedAt) return null;
    return {
      kind: 'refund',
      row: {
        stripeRefundId: String(object.id),
        stripeInvoiceId: object.metadata?.invoice ?? (typeof object.invoice === 'string' ? object.invoice : null),
        stripeCustomerId: customerId(object.customer),
        amount: Number(object.amount ?? 0),
        currency: String(object.currency ?? 'usd'),
        reason: object.reason ?? null,
        refundedAt,
        source,
      },
    };
  }

  return null;
}
