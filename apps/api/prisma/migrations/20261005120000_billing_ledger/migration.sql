-- CreateEnum
CREATE TYPE "BillingInvoiceStatus" AS ENUM ('PAID', 'OPEN', 'UNCOLLECTIBLE', 'VOID');

-- CreateEnum
CREATE TYPE "BillingDataSource" AS ENUM ('STRIPE', 'MOCK');

-- CreateTable
CREATE TABLE "billing_invoices" (
    "id" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "userId" TEXT,
    "status" "BillingInvoiceStatus" NOT NULL,
    "billingReason" TEXT NOT NULL,
    "plan" "UserPlan",
    "interval" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "amountDue" INTEGER NOT NULL,
    "amountPaid" INTEGER NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "source" "BillingDataSource" NOT NULL DEFAULT 'STRIPE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_one_off_payments" (
    "id" TEXT NOT NULL,
    "stripeSessionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "paidAt" TIMESTAMP(3) NOT NULL,
    "source" "BillingDataSource" NOT NULL DEFAULT 'STRIPE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_one_off_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_refunds" (
    "id" TEXT NOT NULL,
    "stripeRefundId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripeCustomerId" TEXT,
    "userId" TEXT,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "reason" TEXT,
    "refundedAt" TIMESTAMP(3) NOT NULL,
    "source" "BillingDataSource" NOT NULL DEFAULT 'STRIPE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_invoices_stripeInvoiceId_key" ON "billing_invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "billing_invoices_issuedAt_idx" ON "billing_invoices"("issuedAt");

-- CreateIndex
CREATE INDEX "billing_invoices_userId_idx" ON "billing_invoices"("userId");

-- CreateIndex
CREATE INDEX "billing_invoices_stripeSubscriptionId_idx" ON "billing_invoices"("stripeSubscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "billing_one_off_payments_stripeSessionId_key" ON "billing_one_off_payments"("stripeSessionId");

-- CreateIndex
CREATE INDEX "billing_one_off_payments_paidAt_idx" ON "billing_one_off_payments"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "billing_refunds_stripeRefundId_key" ON "billing_refunds"("stripeRefundId");

-- CreateIndex
CREATE INDEX "billing_refunds_refundedAt_idx" ON "billing_refunds"("refundedAt");

-- AddForeignKey
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_one_off_payments" ADD CONSTRAINT "billing_one_off_payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing_refunds" ADD CONSTRAINT "billing_refunds_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

