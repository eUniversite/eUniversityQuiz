import { randomBytes } from 'node:crypto'
import type { Plan, StudentPayment } from '@prisma/client'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { gateway } from './geniuspay.js'

/** Tarifs fixés côté serveur : le navigateur n'envoie que le nom de la formule. */
export const PLANS = {
  MONTHLY: { label: 'Mensuel', amount: 1000, months: 1 },
  YEARLY: { label: 'Annuel', amount: 10000, months: 12 },
} as const satisfies Record<Plan, { label: string; amount: number; months: number }>

/** Ajoute des mois en gardant le dernier jour du mois (31 janvier + 1 mois = 28/29 février). */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d)
  const day = r.getUTCDate()
  r.setUTCDate(1)
  r.setUTCMonth(r.getUTCMonth() + months)
  const last = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate()
  r.setUTCDate(Math.min(day, last))
  return r
}

export interface SubscriptionInfo { active: boolean; plan: Plan | null; endsAt: Date | null }

export async function subscriptionOf(studentId: string): Promise<SubscriptionInfo> {
  const s = await prisma.subscription.findFirst({ where: { studentId, endsAt: { gt: new Date() } }, orderBy: { endsAt: 'desc' } })
  return { active: !!s, plan: s?.plan ?? null, endsAt: s?.endsAt ?? null }
}

export interface Entitlements { plan: 'free' | 'paid'; uploadMb: number; courses: number; missions: number }

/** Droits d'un étudiant : abonné = tout ; sinon plan Découverte (fichier léger, un cours, premières missions). */
export async function entitlementsOf(studentId: string): Promise<Entitlements> {
  const sub = await subscriptionOf(studentId)
  return sub.active
    ? { plan: 'paid', uploadMb: config.studyMaxUploadMb, courses: Infinity, missions: Infinity }
    : { plan: 'free', uploadMb: config.freeUploadMb, courses: config.freeCourses, missions: config.freeMissions }
}
/** Version JSON (Infinity n'existe pas en JSON). */
export const publicLimits = (e: Entitlements) => ({ plan: e.plan, uploadMb: e.uploadMb, courses: Number.isFinite(e.courses) ? e.courses : null, missions: Number.isFinite(e.missions) ? e.missions : null })

const returnUrl = (paymentId: string) => `${config.publicUrl}/etudiant/abonnement/retour?payment=${paymentId}`

/** Démarre un paiement. Un paiement en attente récent pour la même formule est réutilisé (pas de doublon si on reclique). */
export async function startCheckout(student: { id: string; name: string; email: string }, plan: Plan): Promise<{ paymentId: string; checkoutUrl: string }> {
  const dayAgo = new Date(Date.now() - 23 * 3600_000) // le lien GeniusPay expire après 24 h
  const reuse = await prisma.studentPayment.findFirst({
    where: { studentId: student.id, plan, status: 'PENDING', checkoutUrl: { not: null }, createdAt: { gt: dayAgo } },
    orderBy: { createdAt: 'desc' },
  })
  if (reuse) return { paymentId: reuse.id, checkoutUrl: reuse.checkoutUrl! }

  const amount = PLANS[plan].amount
  const payment = await prisma.studentPayment.create({ data: { studentId: student.id, plan, amount, reference: `STUDY-${randomBytes(8).toString('hex')}` } })

  // Développement sans clés GeniusPay : paiement simulé, accès immédiat.
  if (!gateway.configured() && !config.prod) {
    await fulfil(payment.id)
    return { paymentId: payment.id, checkoutUrl: returnUrl(payment.id) }
  }

  try {
    const { checkoutUrl, gatewayRef } = await gateway.createCheckout({
      amount, reference: payment.reference, description: `Abonnement eUniversité Study — ${PLANS[plan].label.toLowerCase()}`,
      customer: { name: student.name, email: student.email },
      successUrl: returnUrl(payment.id), errorUrl: `${returnUrl(payment.id)}&status=cancelled`,
      metadata: { payment_reference: payment.reference, student_id: student.id },
    })
    await prisma.studentPayment.update({ where: { id: payment.id }, data: { checkoutUrl, gatewayRef } })
    return { paymentId: payment.id, checkoutUrl }
  } catch (e) {
    await prisma.studentPayment.update({ where: { id: payment.id }, data: { status: 'FAILED' } })
    throw e
  }
}

/** Confirme un paiement et ouvre la période d'accès. Idempotent : un seul appel gagne, les autres ne font rien. */
export async function fulfil(paymentId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const won = await tx.studentPayment.updateMany({ where: { id: paymentId, status: { not: 'COMPLETED' } }, data: { status: 'COMPLETED', paidAt: new Date() } })
    if (won.count === 0) return false
    const p = await tx.studentPayment.findUniqueOrThrow({ where: { id: paymentId } })
    const last = await tx.subscription.findFirst({ where: { studentId: p.studentId, endsAt: { gt: new Date() } }, orderBy: { endsAt: 'desc' } })
    const startsAt = last ? last.endsAt : new Date() // un renouvellement s'ajoute à la fin de la période en cours
    await tx.subscription.create({ data: { studentId: p.studentId, plan: p.plan, startsAt, endsAt: addMonths(startsAt, PLANS[p.plan].months), paymentId } })
    return true
  })
}

export const markReturned = (paymentId: string) =>
  prisma.studentPayment.updateMany({ where: { id: paymentId, returnedAt: null }, data: { returnedAt: new Date() } })

/** Le webhook a-t-il eu son délai avant que le polling n'agisse ? */
export function isDue(p: Pick<StudentPayment, 'returnedAt' | 'createdAt'>, now = Date.now()): boolean {
  const since = p.returnedAt ? +p.returnedAt : +p.createdAt
  const wait = p.returnedAt ? config.billingWebhookGrace : config.billingUnreturnedAfter
  return now - since >= wait * 1000
}

/** Polling de secours : interroge GeniusPay (sans attendre le webhook, mais après le délai de grâce). */
export async function settleFromGateway(p: StudentPayment): Promise<'completed' | 'failed' | null> {
  if (p.status !== 'PENDING' || !p.gatewayRef || !gateway.configured() || !isDue(p)) return null
  const status = await gateway.fetchStatus(p.gatewayRef)
  if (status === 'completed') { await fulfil(p.id); return 'completed' }
  if (status && ['failed', 'cancelled', 'expired'].includes(status)) {
    await prisma.studentPayment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    return 'failed'
  }
  return null
}

/** Tâche de fond : règle les paiements en attente dont le webhook n'est jamais arrivé. */
export async function reconcilePending(): Promise<number> {
  const rows = await prisma.studentPayment.findMany({ where: { status: 'PENDING', gatewayRef: { not: null }, createdAt: { gt: new Date(Date.now() - 48 * 3600_000) } }, take: 100 })
  let n = 0
  for (const p of rows) if (await settleFromGateway(p).catch(() => null)) n++
  return n
}

export function startBillingWorker() {
  const t = setInterval(() => { reconcilePending().catch((e) => console.error('[billing] reconcile', e)) }, 60_000)
  t.unref()
}
