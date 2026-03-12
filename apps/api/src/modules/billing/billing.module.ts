import { Module } from '@nestjs/common';

/**
 * BillingModule
 *
 * Responsibilities:
 *   - Handle Stripe webhook events (POST /webhooks/stripe)
 *   - Sync subscription status to DB when Stripe fires events
 *   - Allocate credits on subscription.created / invoice.paid
 *   - Expose billing portal redirect endpoint
 *
 * Key Stripe events to handle:
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - invoice.paid               → allocate monthly credits
 *   - checkout.session.completed → handle credit pack purchases
 *
 * TODO:
 *   1. Create BillingController with POST /webhooks/stripe (raw body required)
 *   2. Verify Stripe signature with stripe.webhooks.constructEvent()
 *   3. Create BillingService with syncSubscription(), allocateCredits()
 *   4. Link CreditsService to write ALLOCATION ledger on invoice.paid
 */
@Module({})
export class BillingModule {}
