// Load the mock billing history into a NON-PRODUCTION database: the mock
// customers as users with a subscription, then every invoice, image-pack
// payment and refund into the billing ledger, all marked source=MOCK.
//
//   cd apps/web && ALLOW_MOCK_BILLING=1 node --experimental-strip-types scripts/billing-mock/import.mts [--seed 9]
//
// Safe to run again: everything is upserted on its Stripe id or email.
import { PrismaClient } from '@prisma/client';

import { ledgerRecordFromStripe } from '../../src/lib/finance/stripe-records.ts';
// @ts-ignore -- plain .mjs
import { generateMockBilling } from './generate.mjs';

const url = process.env.DATABASE_URL ?? '';
if (process.env.ALLOW_MOCK_BILLING !== '1') {
  console.error('Refusing: set ALLOW_MOCK_BILLING=1 to load mock billing data.');
  process.exit(1);
}
if (/neon\.tech/i.test(url)) {
  console.error('Refusing: DATABASE_URL points at Neon, which is production. Mock billing data never goes there.');
  process.exit(1);
}

const args = process.argv.slice(2);
const seed = Number(args[args.indexOf('--seed') + 1]) || 9;
const mock = generateMockBilling(seed);
const prisma = new PrismaClient();
const STATUS = { active: 'ACTIVE', past_due: 'PAST_DUE', canceled: 'CANCELED' } as const;
const at = (unix: number | null) => (unix ? new Date(unix * 1000) : null);

const subByCustomer = new Map(mock.subscriptions.map((s: any) => [s.customer, s]));
const userIdByCustomer = new Map<string, string>();

for (const c of mock.customers as any[]) {
  const s: any = subByCustomer.get(c.id);
  const plan = s.status === 'canceled' ? 'FREE' : s.metadata.plan;
  const user = await prisma.user.upsert({
    where: { email: c.email },
    create: { email: c.email, name: c.name, plan, createdAt: at(c.created)! },
    update: { name: c.name, plan },
  });
  userIdByCustomer.set(c.id, user.id);
  const sub = {
    stripeSubscriptionId: s.id,
    stripePriceId: s.items.data[0].price.id,
    plan: s.metadata.plan,
    status: STATUS[s.status as keyof typeof STATUS],
    currentPeriodStart: at(s.current_period_start),
    currentPeriodEnd: at(s.current_period_end),
  };
  await prisma.subscription.upsert({
    where: { userId: user.id },
    create: { userId: user.id, stripeCustomerId: c.id, createdAt: at(s.created)!, ...sub },
    update: { stripeCustomerId: c.id, ...sub },
  });
}

// Same writes as recordStripeObject in src/lib/finance/ledger.ts, which this
// script cannot import (it uses the app's @/ alias).
const customerOfInvoice = new Map((mock.invoices as any[]).map((i) => [i.id, i.customer]));
let written = 0;
for (const object of [...mock.invoices, ...mock.sessions, ...mock.refunds]) {
  const record = ledgerRecordFromStripe(object, 'MOCK');
  if (!record) continue;
  if (record.kind === 'invoice') {
    const data = { ...record.row, userId: userIdByCustomer.get(record.row.stripeCustomerId) ?? null };
    await prisma.billingInvoice.upsert({ where: { stripeInvoiceId: data.stripeInvoiceId }, create: data, update: data });
  } else if (record.kind === 'oneOff') {
    const data = { ...record.row, userId: userIdByCustomer.get(record.row.stripeCustomerId) ?? null };
    await prisma.billingOneOffPayment.upsert({ where: { stripeSessionId: data.stripeSessionId }, create: data, update: data });
  } else {
    const customer = record.row.stripeCustomerId ?? (record.row.stripeInvoiceId ? customerOfInvoice.get(record.row.stripeInvoiceId) ?? null : null);
    const data = { ...record.row, stripeCustomerId: customer, userId: customer ? userIdByCustomer.get(customer) ?? null : null };
    await prisma.billingRefund.upsert({ where: { stripeRefundId: data.stripeRefundId }, create: data, update: data });
  }
  written++;
}

console.log(`mock billing loaded: ${mock.customers.length} customers, ${written} ledger rows, gross $${mock.summary.totals_usd.gross_collected}`);
await prisma.$disconnect();
