import crypto from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { prisma } from '../src/db.js'
import { addMonths, isDue } from '../src/billing/index.js'
import { gateway } from '../src/billing/geniuspay.js'
import { isWeakPin } from '../src/validation.js'
import { api, startApp, type App } from './helpers.js'

const SECRET = 'whsec_test'
const RUN = Math.random().toString(36).slice(2, 8)
const ref = (name: string) => `MTX-${name}-${RUN}`
let app: App
beforeAll(async () => { app = await startApp(); config.geniuspayWebhookSecret = SECRET })
afterEach(() => { vi.restoreAllMocks(); config.billingWebhookGrace = 30 })

async function student(pin = '482915') {
  const email = `etu${Date.now()}${Math.random()}@x.fr`
  const r = await api(app, 'POST', '/student/signup', { email, pin, acceptedTerms: true })
  expect(r.status).toBe(201)
  return { email, id: r.json.user.id as string, token: r.json.token as string }
}

function webhook(event: string, tx: Record<string, unknown>, signature?: string) {
  const raw = JSON.stringify({ event, data: { transaction: tx } })
  const ts = String(Math.floor(Date.now() / 1000))
  const sig = signature ?? crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')
  return fetch(`${app.base}/api/billing/webhook/geniuspay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-webhook-timestamp': ts, 'x-webhook-signature': sig, 'x-webhook-event': event }, body: raw })
}

function mockGateway(ref = 'MTX-' + Math.random().toString(36).slice(2, 10)) {
  vi.spyOn(gateway, 'configured').mockReturnValue(true)
  return vi.spyOn(gateway, 'createCheckout').mockResolvedValue({ checkoutUrl: `https://geniuspay.test/checkout/${ref}`, gatewayRef: ref })
}

describe('Inscription par PIN', () => {
  it('crée le compte avec e-mail + PIN, et le PIN sert à se connecter', async () => {
    const s = await student()
    const login = await api(app, 'POST', '/session/login', { email: s.email, password: '482915' })
    expect(login.status).toBe(200)
    expect(login.json.role).toBe('student')
    expect((await api(app, 'POST', '/session/login', { email: s.email, password: '482916' })).status).toBe(401)
  })

  it('refuse un PIN faible ou mal formé, et un e-mail déjà pris', async () => {
    for (const pin of ['123456', '000000', '654321', '121212', '12345', '12345a', '1234567']) {
      const r = await api(app, 'POST', '/student/signup', { email: `w${Math.random()}@x.fr`, pin, acceptedTerms: true })
      expect(r.status, pin).toBe(400)
    }
    const s = await student()
    expect((await api(app, 'POST', '/student/signup', { email: s.email, pin: '482915', acceptedTerms: true })).status).toBe(409)
    expect((await api(app, 'POST', '/student/signup', { email: `n${Math.random()}@x.fr`, pin: '482915', acceptedTerms: false })).status).toBe(400)
  })

  it('reconnaît les PIN faibles', () => {
    for (const p of ['111111', '123456', '987654', '121212', '123123']) expect(isWeakPin(p), p).toBe(true)
    for (const p of ['482915', '135792', '908172']) expect(isWeakPin(p), p).toBe(false)
  })
})

describe('Abonnement', () => {
  it('Study est fermé sans abonnement', async () => {
    const s = await student()
    const r = await api(app, 'GET', '/study/courses', undefined, s.token)
    expect(r.status).toBe(402)
    expect(r.json.code).toBe('SUBSCRIPTION_REQUIRED')
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).json.subscription.active).toBe(false)
  })

  it('affiche les tarifs : 1 000 par mois, 10 000 par an', async () => {
    const plans = (await api(app, 'GET', '/billing/plans')).json
    expect(plans.map((p: any) => [p.plan, p.amount, p.months])).toEqual([['MONTHLY', 1000, 1], ['YEARLY', 10000, 12]])
  })

  it('le prix vient du serveur, et recliquer réutilise le paiement en attente', async () => {
    const s = await student()
    const spy = mockGateway()
    const a = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY', amount: 1 }, s.token)
    expect(a.status).toBe(201)
    expect(spy.mock.calls[0][0].amount).toBe(1000)
    const b = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)
    expect(b.json.paymentId).toBe(a.json.paymentId)
    expect(spy).toHaveBeenCalledTimes(1)
    expect((await api(app, 'POST', '/billing/checkout', { plan: 'FREE' }, s.token)).status).toBe(400)
    expect((await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' })).status).toBe(401)
  })

  it('un paiement GeniusPay refusé ne crée aucun accès et se signale clairement', async () => {
    const s = await student()
    vi.spyOn(gateway, 'configured').mockReturnValue(true)
    const { GatewayError } = await import('../src/billing/geniuspay.js')
    vi.spyOn(gateway, 'createCheckout').mockRejectedValue(new GatewayError('Le service de paiement ne répond pas.'))
    const r = await api(app, 'POST', '/billing/checkout', { plan: 'YEARLY' }, s.token)
    expect(r.status).toBe(502)
    expect((await prisma.studentPayment.findFirst({ where: { studentId: s.id } }))?.status).toBe('FAILED')
  })

  it('le webhook ouvre l’accès une seule fois, et refuse mauvaise signature / paiement inconnu', async () => {
    const s = await student()
    mockGateway(ref('WH1'))
    const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)

    expect((await webhook('payment.success', { reference: ref('WH1') }, 'deadbeef')).status).toBe(401)
    expect((await webhook('payment.success', { reference: ref('INCONNU') })).status).toBe(404)
    expect((await webhook('webhook.test', {})).status).toBe(200)
    expect((await api(app, 'GET', '/study/courses', undefined, s.token)).status).toBe(402)

    expect((await webhook('payment.success', { reference: ref('WH1'), status: 'completed' })).status).toBe(200)
    expect((await api(app, 'GET', '/study/courses', undefined, s.token)).status).toBe(200)
    const before = await prisma.subscription.findMany({ where: { studentId: s.id } })
    expect(before).toHaveLength(1)

    const replay = await webhook('payment.success', { reference: ref('WH1'), status: 'completed' })
    expect((await replay.json()).message).toBe('already processed')
    expect(await prisma.subscription.count({ where: { studentId: s.id } })).toBe(1)
    expect((await api(app, 'GET', `/billing/payments/${paymentId}`, undefined, s.token)).json.status).toBe('COMPLETED')
  })

  it('un renouvellement s’ajoute à la fin de la période en cours', async () => {
    const s = await student()
    for (const [r, plan] of [[ref('R1'), 'MONTHLY'], [ref('R2'), 'YEARLY']] as const) {
      mockGateway(r)
      await api(app, 'POST', '/billing/checkout', { plan }, s.token)
      await webhook('payment.success', { reference: r })
    }
    const subs = await prisma.subscription.findMany({ where: { studentId: s.id }, orderBy: { startsAt: 'asc' } })
    expect(subs.map((x) => x.plan)).toEqual(['MONTHLY', 'YEARLY'])
    expect(+subs[1].startsAt).toBe(+subs[0].endsAt)
    expect(+subs[1].endsAt).toBe(+addMonths(subs[0].endsAt, 12))
  })

  it('le polling attend le délai de grâce du webhook avant d’agir', async () => {
    const s = await student()
    mockGateway(ref('POLL'))
    const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)
    const fetchStatus = vi.spyOn(gateway, 'fetchStatus').mockResolvedValue('completed')

    // Retour de l'étudiant à l'instant : GeniusPay n'est pas encore interrogé.
    expect((await api(app, 'GET', `/billing/payments/${paymentId}`, undefined, s.token)).json.status).toBe('PENDING')
    expect(fetchStatus).not.toHaveBeenCalled()

    // Délai écoulé : le polling règle le paiement sans webhook.
    config.billingWebhookGrace = 0
    const r = await api(app, 'GET', `/billing/payments/${paymentId}`, undefined, s.token)
    expect(r.json.status).toBe('COMPLETED')
    expect(r.json.subscription.active).toBe(true)
  })

  it('un paiement annulé chez GeniusPay est marqué en échec', async () => {
    const s = await student()
    mockGateway(ref('CANCEL'))
    const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)
    vi.spyOn(gateway, 'fetchStatus').mockResolvedValue('cancelled')
    config.billingWebhookGrace = 0
    expect((await api(app, 'GET', `/billing/payments/${paymentId}`, undefined, s.token)).json.status).toBe('FAILED')
  })

  it('un étudiant ne voit pas le paiement d’un autre', async () => {
    const a = await student(), b = await student()
    mockGateway(ref('OWN'))
    const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, a.token)
    expect((await api(app, 'GET', `/billing/payments/${paymentId}`, undefined, b.token)).status).toBe(404)
  })

  it('sans clés GeniusPay (développement), le paiement est simulé et ouvre l’accès', async () => {
    const s = await student()
    vi.spyOn(gateway, 'configured').mockReturnValue(false)
    expect((await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)).status).toBe(201)
    expect((await api(app, 'GET', '/study/courses', undefined, s.token)).status).toBe(200)
  })
})

describe('Calcul des périodes', () => {
  it('ajoute des mois en gardant le dernier jour du mois', () => {
    expect(addMonths(new Date('2027-01-31T10:00:00Z'), 1).toISOString()).toBe('2027-02-28T10:00:00.000Z')
    expect(addMonths(new Date('2028-01-31T10:00:00Z'), 1).toISOString()).toBe('2028-02-29T10:00:00.000Z')
    expect(addMonths(new Date('2026-11-10T10:00:00Z'), 12).toISOString()).toBe('2027-11-10T10:00:00.000Z')
    expect(addMonths(new Date('2026-12-15T10:00:00Z'), 1).toISOString()).toBe('2027-01-15T10:00:00.000Z')
  })

  it('applique les deux délais du polling', () => {
    const now = Date.now()
    expect(isDue({ returnedAt: new Date(now - 10_000), createdAt: new Date(now - 3600_000) }, now)).toBe(false)
    expect(isDue({ returnedAt: new Date(now - 31_000), createdAt: new Date(now - 3600_000) }, now)).toBe(true)
    expect(isDue({ returnedAt: null, createdAt: new Date(now - 60_000) }, now)).toBe(false)
    expect(isDue({ returnedAt: null, createdAt: new Date(now - 601_000) }, now)).toBe(true)
  })
})
