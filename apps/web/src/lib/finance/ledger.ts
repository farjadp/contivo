import type { PrismaClient } from '@prisma/client';

import { prisma } from '@/lib/db';
import { computeFinance, type FinanceSummary } from './metrics';
import { ledgerRecordFromStripe, type LedgerSource } from './stripe-records';

type Db = Pick<PrismaClient, 'subscription' | 'billingInvoice' | 'billingOneOffPayment' | 'billingRefund'>;

/**
 * Write one Stripe object (invoice, payment-mode Checkout Session or refund)
 * to the billing ledger. Idempotent on the Stripe id, so a replayed webhook
 * only refreshes the row. Returns what was written, or null when the object is
 * not something the ledger keeps.
 *
 * The Stripe webhook on branch pricing-packages should call this for
 * invoice.paid, invoice.payment_failed, invoice.marked_uncollectible,
 * invoice.voided, checkout.session.completed and charge.refunded.
 */
export async function recordStripeObject(object: Record<string, unknown>, source: LedgerSource = 'STRIPE', db: Db = prisma) {
  const record = ledgerRecordFromStripe(object, source);
  if (!record) return null;

  const userIdFor = async (stripeCustomerId: string | null) =>
    stripeCustomerId
      ? (await db.subscription.findUnique({ where: { stripeCustomerId }, select: { userId: true } }))?.userId ?? null
      : null;

  if (record.kind === 'invoice') {
    const data = { ...record.row, userId: await userIdFor(record.row.stripeCustomerId) };
    await db.billingInvoice.upsert({ where: { stripeInvoiceId: data.stripeInvoiceId }, create: data, update: data });
  } else if (record.kind === 'oneOff') {
    const data = { ...record.row, userId: await userIdFor(record.row.stripeCustomerId) };
    await db.billingOneOffPayment.upsert({ where: { stripeSessionId: data.stripeSessionId }, create: data, update: data });
  } else {
    // A refund names its charge, not its customer; find the customer through the invoice.
    const customer =
      record.row.stripeCustomerId ??
      (record.row.stripeInvoiceId
        ? (await db.billingInvoice.findUnique({ where: { stripeInvoiceId: record.row.stripeInvoiceId }, select: { stripeCustomerId: true } }))?.stripeCustomerId ?? null
        : null);
    const data = { ...record.row, stripeCustomerId: customer, userId: await userIdFor(customer) };
    await db.billingRefund.upsert({ where: { stripeRefundId: data.stripeRefundId }, create: data, update: data });
  }
  return record;
}

export type AdminFinance = FinanceSummary & {
  hasMockData: boolean;
  emailByCustomer: Record<string, string>;
  recentInvoices: Array<{ id: string; stripeInvoiceId: string; stripeCustomerId: string; status: string; plan: string | null; interval: string; amountDue: number; amountPaid: number; issuedAt: Date; billingReason: string }>;
  recentRefunds: Array<{ id: string; stripeCustomerId: string | null; amount: number; reason: string | null; refundedAt: Date }>;
};

/** Everything the admin finance section shows, from the ledger. */
export async function getAdminFinance(now = new Date()): Promise<AdminFinance> {
  const [invoices, oneOffs, refunds, subscriptions, mockRows] = await Promise.all([
    prisma.billingInvoice.findMany({ orderBy: { issuedAt: 'desc' } }),
    prisma.billingOneOffPayment.findMany({ select: { amount: true, paidAt: true } }),
    prisma.billingRefund.findMany({ orderBy: { refundedAt: 'desc' } }),
    prisma.subscription.findMany({
      select: { stripeSubscriptionId: true, stripeCustomerId: true, status: true, user: { select: { email: true } } },
    }),
    prisma.billingInvoice.count({ where: { source: 'MOCK' } }),
  ]);

  const summary = computeFinance({ invoices, oneOffs, refunds, subscriptions, now });
  return {
    ...summary,
    hasMockData: mockRows > 0,
    emailByCustomer: Object.fromEntries(subscriptions.map((s) => [s.stripeCustomerId, s.user.email])),
    recentInvoices: invoices.slice(0, 25),
    recentRefunds: refunds.slice(0, 10),
  };
}
