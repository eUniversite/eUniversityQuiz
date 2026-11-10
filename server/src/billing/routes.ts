import express, { type Request, type RequestHandler, type Response } from 'express'
import { prisma } from '../db.js'
import { RateLimiter } from '../security.js'
import { checkoutSchema } from '../validation.js'
import { fulfil, markReturned, PLANS, settleFromGateway, startCheckout, subscriptionOf } from './index.js'
import { GatewayError, verifyWebhookSignature } from './geniuspay.js'

type AH = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler

const checkoutsByStudent = new RateLimiter(10, 60 * 60_000)

/** Routes d'abonnement. `requireStudent` et `ah` viennent de http.ts. */
export function buildBillingRouter(requireStudent: RequestHandler, ah: AH) {
  const r = express.Router()

  r.get('/plans', (_req, res) => {
    res.json((Object.keys(PLANS) as (keyof typeof PLANS)[]).map((plan) => ({ plan, ...PLANS[plan], currency: 'XOF' })))
  })

  r.post('/checkout', requireStudent, ah(async (req, res) => {
    const { plan } = checkoutSchema.parse(req.body)
    if (!checkoutsByStudent.hit(req.studentId!)) return res.status(429).json({ error: 'Trop de tentatives de paiement. Réessayez dans une heure.' })
    const student = await prisma.student.findUniqueOrThrow({ where: { id: req.studentId } })
    try { res.status(201).json(await startCheckout(student, plan)) }
    catch (e) {
      if (e instanceof GatewayError) return res.status(502).json({ error: e.message })
      throw e
    }
  }))

  // Suivi d'un paiement par la page de retour. Chaque consultation compte comme « retour » : le polling de secours
  // n'interroge GeniusPay qu'après le délai de grâce laissé au webhook.
  r.get('/payments/:id', requireStudent, ah(async (req, res) => {
    let p = await prisma.studentPayment.findFirst({ where: { id: String(req.params.id), studentId: req.studentId } })
    if (!p) return res.status(404).json({ error: 'Paiement introuvable.' })
    if (p.status === 'PENDING') {
      await markReturned(p.id)
      p = (await prisma.studentPayment.findUnique({ where: { id: p.id } }))!
      await settleFromGateway(p)
      p = (await prisma.studentPayment.findUnique({ where: { id: p.id } }))!
    }
    res.json({ status: p.status, plan: p.plan, amount: p.amount, subscription: await subscriptionOf(req.studentId!) })
  }))

  return r
}

/** Webhook GeniusPay (public, signature obligatoire). Le corps brut est conservé par app.ts dans `req.rawBody`. */
export const geniuspayWebhook: RequestHandler = async (req, res, next) => {
  try {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from('')
    if (!verifyWebhookSignature(raw, req.header('X-Webhook-Signature'), req.header('X-Webhook-Timestamp'), req.ip)) return res.status(401).json({ error: 'Signature invalide.' })

    const event = String(req.body?.event ?? req.header('X-Webhook-Event') ?? '')
    if (!event.startsWith('payment.')) return res.json({ success: true, message: 'event ignored' }) // ex. webhook.test du dashboard

    const tx = req.body?.data?.transaction ?? {}
    const ref = typeof tx.reference === 'string' ? tx.reference : undefined
    const mine = tx.external_reference ?? tx.metadata?.payment_reference
    const payment = await prisma.studentPayment.findFirst({ where: { OR: [...(ref ? [{ gatewayRef: ref }] : []), ...(typeof mine === 'string' ? [{ reference: mine }] : [])] } })
    if (!payment) return res.status(404).json({ error: 'Paiement introuvable.' })

    if (event === 'payment.success' || tx.status === 'completed') {
      const done = await fulfil(payment.id)
      return res.json({ success: true, message: done ? 'activated' : 'already processed' })
    }
    if (['payment.failed', 'payment.cancelled'].includes(event)) {
      await prisma.studentPayment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    }
    res.json({ success: true })
  } catch (e) { next(e) }
}
