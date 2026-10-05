// Mock Contivo billing history, shaped like Stripe API objects, from launch (1 Aug 2026) to 5 Oct 2026.
// Fictional people and businesses; every email is on a .test domain so nothing can ever reach a real inbox.
// Deterministic: same seed, same data. Prices follow branch pricing-packages (USD, before tax).
//
//   node generate.mjs            → writes ./out/*.json, ./out/*.csv, ./out/summary.json
//   node generate.mjs --seed 7   → a different, equally plausible history
import fs from 'node:fs';
import path from 'node:path';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
const LAUNCH = Date.UTC(2026, 7, 1);           // 1 Aug 2026
const NOW = Date.UTC(2026, 9, 5, 18, 0, 0);    // 5 Oct 2026
const TARGET = 12_000_00;                      // cents, gross collected
const DAY = 86_400_000;

const PLANS = {
  STARTER: { name: 'Founder', month: 5500, year: 55000 },
  PRO: { name: 'Growth', month: 8900, year: 89000 },
  AGENCY: { name: 'Agency', month: 23300, year: 233000 },
};
const EXTRA_BRAND = 3400;  // per month, Agency only
const IMAGE_PACK = 3400;   // one-off, 55 images
const FOUNDING_SEATS = 50;


function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const FIRST = ['Nima', 'Sara', 'Arash', 'Leila', 'Kian', 'Mahsa', 'Reza', 'Shirin', 'Daniel', 'Emily', 'Marc-André', 'Priya', 'Omar', 'Hannah', 'Lucas', 'Chloé', 'Babak', 'Yasmin', 'Ethan', 'Maya', 'Farid', 'Nazanin', 'Jordan', 'Olivia', 'Amir', 'Golnaz', 'Ryan', 'Isabelle', 'Kourosh', 'Tara', 'Mehdi', 'Sophie', 'Darius', 'Aisha', 'Liam', 'Roya', 'Noah', 'Parisa', 'Gabriel', 'Ava'];
const LAST = ['Tehrani', 'Karimi', 'MacLeod', 'Rahimi', 'Nguyen', 'Bouchard', 'Hosseini', 'Patel', 'Sadeghi', 'Thompson', 'Moradi', 'Tremblay', 'Ahmadi', 'Chen', 'Farahani', 'Wilson', 'Jafari', 'Gagnon', 'Ebrahimi', 'Singh', 'Ansari', 'Campbell', 'Rezaei', 'Kowalski', 'Najafi', 'Fraser'];
const PLACES = ['Yorkville', 'Richmond Hill', 'North York', 'Kitsilano', 'Laval', 'Oakville', 'Markham', 'Westboro', 'Kensington', 'Lonsdale', 'Bayview', 'Mile End', 'Burnaby', 'Aurora', 'Leslieville'];
const KINDS = [
  ['Dental Studio', 'Dental clinic'], ['Family Dentistry', 'Dental clinic'], ['Realty Group', 'Real estate'], ['Homes Team', 'Real estate'],
  ['Immigration Consulting', 'Immigration'], ['Law Professional Corp.', 'Law firm'], ['Physiotherapy', 'Health clinic'], ['Medical Aesthetics', 'Health clinic'],
  ['Renovations', 'Home services'], ['Custom Homes', 'Home builder'], ['Accounting & Tax', 'Accounting'], ['Mortgage Partners', 'Finance'],
  ['Event Hall', 'Events'], ['Bakery & Café', 'Hospitality'], ['Fitness Lab', 'Fitness'], ['Hair Studio', 'Beauty'], ['Digital', 'Marketing agency'], ['Creative Co.', 'Marketing agency'],
];

const slug = (s) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '').slice(0, 24);
const unix = (ms) => Math.floor(ms / 1000);
const addMonths = (ms, n) => { const d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

function build(seed, signupCount) {
  const r = rng(seed);
  const pick = (a) => a[Math.floor(r() * a.length)];
  const id = (p) => `${p}_test_${Array.from({ length: 14 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(r() * 36)]).join('')}`;

  const customers = [], subscriptions = [], invoices = [], refunds = [], sessions = [], events = [];
  let paidSeats = 0;
  const usedNames = new Set();

  for (let i = 0; i < signupCount; i++) {
    // Sign-ups ramp up after launch: more in September than August, a trickle in October.
    const f = Math.pow(r(), 0.8);
    const created = LAUNCH + Math.floor(f * (NOW - LAUNCH - 2 * DAY));
    let person, business;
    do {
      person = `${pick(FIRST)} ${pick(LAST)}`;
      const [suffix, industry] = pick(KINDS);
      const head = r() < 0.5 ? person.split(' ')[1] : pick(PLACES);
      business = { name: `${head} ${suffix}`, industry };
    } while (usedNames.has(business.name));
    usedNames.add(business.name);
    const domain = `${slug(business.name)}.test`;
    const cus = {
      id: id('cus'), object: 'customer', created: unix(created), email: `${slug(person.split(' ')[0])}@${domain}`,
      name: person, currency: 'usd', livemode: false,
      address: { country: 'CA', state: pick(['ON', 'ON', 'ON', 'BC', 'QC']) },
      metadata: { business: business.name, industry: business.industry, signup_date: iso(created) },
    };
    customers.push(cus);

    const roll = r();
    const plan = business.industry === 'Marketing agency' ? (roll < 0.7 ? 'AGENCY' : 'PRO') : roll < 0.55 ? 'STARTER' : roll < 0.88 ? 'PRO' : 'AGENCY';
    const interval = r() < 0.08 ? 'year' : 'month';
    const extraBrands = plan === 'AGENCY' && r() < 0.35 ? 1 + Math.floor(r() * 3) : 0;
    const founding = paidSeats < FOUNDING_SEATS;
    paidSeats++;

    // What happens to this customer after sign-up.
    const fate = r();
    const churnAfter = fate < 0.12 ? 1 : fate < 0.17 ? 2 : Infinity;          // cancels after N paid periods
    const upgradeAt = plan === 'STARTER' && fate > 0.8 ? 1 : null;             // moves to Growth at 2nd cycle
    const failsAt = fate > 0.88 ? 1 : null;                                    // 2nd charge fails
    const recovers = failsAt !== null && r() < 0.6;
    const refundFirst = fate > 0.17 && fate < 0.2;                             // asks for money back in week one

    const subId = id('sub');
    let currentPlan = plan;
    let status = 'active';
    let canceledAt = null;
    let cancelAtPeriodEnd = false;
    let periodStart = created;
    let cycle = 0;
    let paidPeriods = 0;
    while (periodStart <= NOW) {
      const periodEnd = interval === 'year' ? addMonths(periodStart, 12) : addMonths(periodStart, 1);
      if (upgradeAt !== null && cycle === upgradeAt) currentPlan = 'PRO';
      const base = interval === 'year' ? PLANS[currentPlan].year : PLANS[currentPlan].month;
      const extras = extraBrands * EXTRA_BRAND * (interval === 'year' ? 10 : 1);
      const amount = base + extras;
      const failed = failsAt !== null && cycle === failsAt;
      const inv = {
        id: id('in'), object: 'invoice', customer: cus.id, subscription: subId, currency: 'usd', livemode: false,
        created: unix(periodStart), period_start: unix(periodStart), period_end: unix(periodEnd),
        billing_reason: cycle === 0 ? 'subscription_create' : upgradeAt === cycle ? 'subscription_update' : 'subscription_cycle',
        amount_due: amount, amount_paid: failed && !recovers ? 0 : amount, amount_remaining: failed && !recovers ? amount : 0,
        attempt_count: failed ? (recovers ? 2 : 4) : 1,
        status: failed && !recovers ? 'uncollectible' : 'paid',
        status_transitions: { paid_at: failed && !recovers ? null : unix(periodStart + (failed ? 3 * DAY : 60_000)) },
        charge: failed && !recovers ? null : id('ch'),
        lines: { data: [
          { description: `Contivo ${PLANS[currentPlan].name} (${interval === 'year' ? 'annual' : 'monthly'})`, amount: base, price: { id: `price_test_${currentPlan.toLowerCase()}_${interval}`, unit_amount: base, recurring: { interval } } },
          ...(extras ? [{ description: `Extra brand × ${extraBrands}`, amount: extras, price: { id: `price_test_extra_brand_${interval}`, unit_amount: EXTRA_BRAND, recurring: { interval } } }] : []),
        ] },
        metadata: { plan: currentPlan, founding_member: String(founding) },
      };
      invoices.push(inv);
      events.push({ type: failed ? (recovers ? 'invoice.payment_failed→paid' : 'invoice.payment_failed') : 'invoice.paid', at: iso(periodStart), customer: cus.id, amount });
      if (failed && !recovers) { status = 'past_due'; if (periodStart + 14 * DAY <= NOW) { status = 'canceled'; canceledAt = periodStart + 14 * DAY; } break; }
      paidPeriods++;
      if (cycle === 0 && refundFirst && periodStart + 5 * DAY <= NOW) {
        refunds.push({ id: id('re'), object: 'refund', charge: inv.charge, amount, currency: 'usd', created: unix(periodStart + 5 * DAY), reason: 'requested_by_customer', status: 'succeeded', metadata: { invoice: inv.id } });
        status = 'canceled'; canceledAt = periodStart + 5 * DAY; break;
      }
      if (paidPeriods >= churnAfter) {
        // They cancel during the period; access lasts until it ends.
        if (periodEnd <= NOW) { status = 'canceled'; canceledAt = periodEnd; } else { cancelAtPeriodEnd = true; }
        break;
      }
      cycle++;
      periodStart = periodEnd;
    }

    // Image packs: Growth and Agency customers buy them now and then.
    if (currentPlan !== 'STARTER' && r() < 0.3) {
      const times = 1 + Math.floor(r() * 2);
      for (let k = 0; k < times; k++) {
        const at = created + Math.floor(r() * Math.max(DAY, NOW - created));
        if (canceledAt && at > canceledAt) continue;
        sessions.push({ id: id('cs'), object: 'checkout.session', mode: 'payment', customer: cus.id, created: unix(at), currency: 'usd', amount_total: IMAGE_PACK, payment_status: 'paid', status: 'complete', livemode: false, metadata: { kind: 'IMAGE_PACK', images: '55' } });
      }
    }

    const last = invoices.filter((x) => x.subscription === subId).at(-1);
    subscriptions.push({
      id: subId, object: 'subscription', customer: cus.id, status, livemode: false, created: unix(created),
      current_period_start: last.period_start, current_period_end: last.period_end,
      cancel_at_period_end: cancelAtPeriodEnd, canceled_at: canceledAt ? unix(canceledAt) : null,
      items: { data: [{ price: { id: `price_test_${currentPlan.toLowerCase()}_${interval}`, unit_amount: interval === 'year' ? PLANS[currentPlan].year : PLANS[currentPlan].month, recurring: { interval } }, quantity: 1 }] },
      metadata: { plan: currentPlan, founding_member: String(founding), extra_brands: String(extraBrands) },
    });
  }

  const collected = invoices.reduce((s, x) => s + x.amount_paid, 0) + sessions.reduce((s, x) => s + x.amount_total, 0);
  const refunded = refunds.reduce((s, x) => s + x.amount, 0);
  return { customers, subscriptions, invoices, refunds, sessions, events, collected, refunded };
}

/** The whole mock history for one seed: Stripe-shaped lists plus the summary they add up to. */
export function generateMockBilling(baseSeed = 9) {
  // Pick the sign-up count whose gross collected lands closest to the target.
  let best = null;
  for (let n = 40; n <= 160; n++) {
    const d = build(baseSeed, n);
    if (!best || Math.abs(d.collected - TARGET) < Math.abs(best.collected - TARGET)) best = d;
  }
  const d = best;

  // Summary the finance screens can be checked against.
  const months = ['2026-08', '2026-09', '2026-10'];
  const byMonth = Object.fromEntries(months.map((m) => [m, { gross: 0, refunds: 0, net: 0, new_customers: 0, churned: 0, failed_payments: 0 }]));
  const monthOf = (s) => new Date(s * 1000).toISOString().slice(0, 7);
  for (const i of d.invoices) { const m = byMonth[monthOf(i.created)]; if (m) { m.gross += i.amount_paid; if (i.status !== 'paid' || i.attempt_count > 1) m.failed_payments++; } }
  for (const s of d.sessions) byMonth[monthOf(s.created)].gross += s.amount_total;
  for (const x of d.refunds) byMonth[monthOf(x.created)].refunds += x.amount;
  for (const c of d.customers) byMonth[monthOf(c.created)].new_customers++;
  for (const s of d.subscriptions) if (s.canceled_at) byMonth[monthOf(s.canceled_at)].churned++;
  for (const m of months) byMonth[m].net = byMonth[m].gross - byMonth[m].refunds;

  const active = d.subscriptions.filter((s) => s.status === 'active' || s.status === 'past_due');
  const mrr = active.reduce((sum, s) => {
    const p = s.items.data[0].price; const monthly = p.recurring.interval === 'year' ? Math.round(p.unit_amount / 12) : p.unit_amount;
    const extras = Number(s.metadata.extra_brands) * EXTRA_BRAND;
    return sum + monthly + extras;
  }, 0);
  const dollars = (c) => Math.round(c) / 100;
  const summary = {
    note: 'MOCK DATA. Fictional customers, Stripe test-mode shapes, USD before tax. Never load into production.',
    period: { from: iso(LAUNCH), to: iso(NOW) },
    seed: baseSeed,
    totals_usd: { gross_collected: dollars(d.collected), refunded: dollars(d.refunded), net: dollars(d.collected - d.refunded) },
    customers: d.customers.length,
    subscriptions_by_status: d.subscriptions.reduce((a, s) => ({ ...a, [s.status]: (a[s.status] ?? 0) + 1 }), {}),
    active_by_plan: active.reduce((a, s) => ({ ...a, [s.metadata.plan]: (a[s.metadata.plan] ?? 0) + 1 }), {}),
    annual_subscriptions: d.subscriptions.filter((s) => s.items.data[0].price.recurring.interval === 'year').length,
    founding_members: d.subscriptions.filter((s) => s.metadata.founding_member === 'true').length,
    image_packs_sold: d.sessions.length,
    mrr_usd_now: dollars(mrr),
    by_month_usd: Object.fromEntries(months.map((m) => [m, Object.fromEntries(Object.entries(byMonth[m]).map(([k, v]) => [k, ['gross', 'refunds', 'net'].includes(k) ? dollars(v) : v]))])),
  };

  return { ...d, summary };
}

// CLI: node generate.mjs [--seed N] → writes ./out/*.json, ./out/invoices.csv and ./out/summary.json
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const args = process.argv.slice(2);
  const d = generateMockBilling(Number(args[args.indexOf('--seed') + 1]) || 9);
  const summary = d.summary;
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, rows] of Object.entries({ customers: d.customers, subscriptions: d.subscriptions, invoices: d.invoices, refunds: d.refunds, checkout_sessions: d.sessions })) {
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify({ object: 'list', data: rows }, null, 2));
  }
  const cusById = Object.fromEntries(d.customers.map((c) => [c.id, c]));
  const header = ['date', 'invoice', 'customer', 'business', 'email', 'plan', 'interval', 'reason', 'status', 'amount_due_usd', 'amount_paid_usd'];
  const rows = d.invoices.map((i) => {
    const c = cusById[i.customer];
    return [iso(i.created * 1000), i.id, c.name, c.metadata.business, c.email, i.metadata.plan, i.lines.data[0].price.recurring.interval,
      i.billing_reason, i.status, (i.amount_due / 100).toFixed(2), (i.amount_paid / 100).toFixed(2)];
  });
  fs.writeFileSync(path.join(OUT, 'invoices.csv'), [header, ...rows].map((r) => r.map((v) => JSON.stringify(v)).join(',')).join('\n') + '\n');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));

}
