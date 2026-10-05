# Admin finance section

Date: 5 Oct 2026. Branch `feat/admin-finance`, off `main` (`a75b29e`).

## Decisions (Farjad, 5 Oct)

- **Source of truth:** our own tables, filled by Stripe. The admin never calls Stripe to draw a page. Staging and local fill the same tables from the mock history in `apps/web/scripts/billing-mock/`.
- **Audience:** the founder, in admin. No customer-facing billing page in this change.
- **Branch:** standalone off `main`. `pricing-packages` (Stripe checkout and webhook) is unmerged and 137 commits behind; when it lands, its webhook calls `recordStripeObject` and writes to these same tables.

## Data model

Three append-mostly tables, keyed by the Stripe id so a replayed webhook or a re-run import upserts instead of duplicating. Amounts are integer cents, USD, before tax.

| Table | One row per | Key |
|---|---|---|
| `billing_invoices` | subscription invoice (create, cycle, update) | `stripeInvoiceId` |
| `billing_one_off_payments` | paid Checkout Session in payment mode (image pack) | `stripeSessionId` |
| `billing_refunds` | refund | `stripeRefundId` |

Every row carries `source` (`STRIPE` or `MOCK`) and an optional `userId`, resolved through `subscriptions.stripeCustomerId`. The existing `subscriptions` table is not changed, so this cannot collide with the columns `pricing-packages` adds to it.

## Metrics, and how each is defined

All computed by one pure function, `computeFinance`, from rows; unit-tested.

- **Gross** in a month: `amountPaid` of invoices issued that month plus one-off payments paid that month.
- **Refunds** in a month: refunds made that month. **Net** = gross − refunds.
- **MRR now:** for every subscription that is `ACTIVE` or `PAST_DUE`, the `amountDue` of its latest invoice, divided by 12 when that invoice is annual.
- **New paying customers** in a month: customers whose first paid invoice is in that month.
- **Churned** in a month: subscriptions now `CANCELED` whose last invoice period ended that month.
- **Needs attention:** invoices `OPEN` or `UNCOLLECTIBLE` (money not collected), newest first.
- **By plan:** active subscriptions and MRR per plan.

## Screen

A new admin section, `?section=finance`, between Integrations and Credits:

1. KPI row: MRR, net revenue to date, paying customers, churned this month, open failed payments.
2. Net revenue by month (bar chart) and a month table: gross, refunds, net, new, churned.
3. MRR and customers by plan.
4. Needs attention: failed and uncollectible invoices with customer and amount.
5. Recent invoices and refunds.

When any row has `source = MOCK` the section shows a banner saying the numbers include mock data. Both locales, through the `admin` message namespace; numbers and money through the request formatter.

## Mock data

`apps/web/scripts/billing-mock/generate.mjs` (moved from `.claude/mock-data`) writes Stripe-shaped JSON. `import-billing-mock.mts` loads it through `recordStripeObject`, after creating the mock users and subscriptions. It refuses to run unless `ALLOW_MOCK_BILLING=1`, and refuses any database whose host is `neon.tech` (production).

## Out of scope

Sales tax, Stripe fees, disputes, multi-currency, the customer billing page, wiring the webhook (lands with `pricing-packages`).
