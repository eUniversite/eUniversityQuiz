-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "PayStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "StudentPayment" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT NOT NULL,
    "gatewayRef" TEXT,
    "checkoutUrl" TEXT,
    "status" "PayStatus" NOT NULL DEFAULT 'PENDING',
    "returnedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "plan" "Plan" NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "paymentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentPayment_reference_key" ON "StudentPayment"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPayment_gatewayRef_key" ON "StudentPayment"("gatewayRef");

-- CreateIndex
CREATE INDEX "StudentPayment_studentId_status_idx" ON "StudentPayment"("studentId", "status");

-- CreateIndex
CREATE INDEX "StudentPayment_status_createdAt_idx" ON "StudentPayment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paymentId_key" ON "Subscription"("paymentId");

-- CreateIndex
CREATE INDEX "Subscription_studentId_endsAt_idx" ON "Subscription"("studentId", "endsAt");

-- AddForeignKey
ALTER TABLE "StudentPayment" ADD CONSTRAINT "StudentPayment_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "StudentPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
