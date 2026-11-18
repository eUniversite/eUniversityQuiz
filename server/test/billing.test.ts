import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { prisma } from '../src/db.js'
import { addMonths, isDue } from '../src/billing/index.js'
import { gateway, GatewayError } from '../src/billing/geniuspay.js'
import { api, startApp, type App } from './helpers.js'

const SECRET = 'whsec_test'
const RUN = Math.random().toString(36).slice(2, 8)
const ref = (name: string) => `MTX-${name}-${RUN}`
let app: App
beforeAll(async () => { app = await startApp(); config.geniuspayWebhookSecret = SECRET })
afterEach(() => { vi.restoreAllMocks(); config.billingWebhookGrace = 30 })

async function student(password = 'motdepasse1') {
  const email = `etu${Date.now()}${Math.random()}@x.fr`
  const r = await api(app, 'POST', '/student/signup', { email, password, acceptedTerms: true })
  expect(r.status).toBe(201)
  return { email, id: r.json.user.id as string, token: r.json.token as string }
}

/** Livraison v2 : { event_type, transaction_ref }, signature « t=…,v1=… ». `sig` remplace la signature valide. */
function webhook(event: string, reference: string, status?: string, sig?: string) {
  const raw = JSON.stringify({ event_type: event, transaction_ref: reference, ...(status ? { status } : {}) })
  const ts = String(Math.floor(Date.now() / 1000))
  const v1 = sig ?? crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')
  return fetch(`${app.base}/api/billing/webhook/geniuspay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-geniuspay-timestamp': ts, 'x-geniuspay-signature': `t=${ts},v1=${v1}` }, body: raw })
}

async function refOf(paymentId: string) {
  return (await prisma.studentPayment.findUniqueOrThrow({ where: { id: paymentId } })).reference
}

function mockGateway(ref = 'MTX-' + Math.random().toString(36).slice(2, 10)) {
  vi.spyOn(gateway, 'configured').mockReturnValue(true)
  return vi.spyOn(gateway, 'createCheckout').mockResolvedValue({ checkoutUrl: `https://geniuspay.test/checkout/${ref}`, gatewayRef: ref })
}

describe('Inscription par e-mail', () => {
  it('crée le compte avec e-mail + mot de passe, sans rien payer', async () => {
    const s = await student()
    const login = await api(app, 'POST', '/session/login', { email: s.email, password: 'motdepasse1' })
    expect(login.status).toBe(200)
    expect(login.json.role).toBe('student')
    expect((await api(app, 'POST', '/session/login', { email: s.email, password: 'motdepasse2' })).status).toBe(401)
  })

  it('refuse un mot de passe trop court, des conditions non acceptées et un e-mail déjà pris', async () => {
    expect((await api(app, 'POST', '/student/signup', { email: `w${Math.random()}@x.fr`, password: '1234567', acceptedTerms: true })).status).toBe(400)
    const s = await student()
    expect((await api(app, 'POST', '/student/signup', { email: s.email, password: 'motdepasse1', acceptedTerms: true })).status).toBe(409)
    expect((await api(app, 'POST', '/student/signup', { email: `n${Math.random()}@x.fr`, password: 'motdepasse1', acceptedTerms: false })).status).toBe(400)
  })

  it('un ancien compte à PIN à 6 chiffres peut toujours se connecter', async () => {
    const email = `pin${Date.now()}@x.fr`
    await prisma.student.create({ data: { email, name: 'Ancien', passwordHash: await bcrypt.hash('482915', 4) } })
    expect((await api(app, 'POST', '/session/login', { email, password: '482915' })).status).toBe(200)
  })
})

describe('Abonnement', () => {
  it('Study est ouvert sans abonnement, en plan Découverte', async () => {
    const s = await student()
    expect((await api(app, 'GET', '/study/courses', undefined, s.token)).status).toBe(200)
    const me = (await api(app, 'GET', '/student/me', undefined, s.token)).json
    expect(me.subscription.active).toBe(false)
    expect(me.limits).toEqual({ plan: 'free', uploadMb: 2, courses: 1, missions: 3 })
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

    const r = await refOf(paymentId)
    expect((await webhook('transaction.completed', r, 'completed', 'deadbeef')).status).toBe(401)
    expect((await webhook('transaction.completed', ref('INCONNU'))).status).toBe(404)
    expect((await webhook('webhook.test', r)).status).toBe(200)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).json.limits.plan).toBe('free')

    expect((await webhook('transaction.completed', r, 'completed')).status).toBe(200)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).json.limits.plan).toBe('paid')
    const before = await prisma.subscription.findMany({ where: { studentId: s.id } })
    expect(before).toHaveLength(1)

    const replay = await webhook('transaction.completed', r, 'completed')
    expect((await replay.json()).message).toBe('already processed')
    expect(await prisma.subscription.count({ where: { studentId: s.id } })).toBe(1)
    expect((await api(app, 'GET', `/billing/payments/${paymentId}`, undefined, s.token)).json.status).toBe('COMPLETED')
  })

  it('un renouvellement s’ajoute à la fin de la période en cours', async () => {
    const s = await student()
    for (const [r, plan] of [[ref('R1'), 'MONTHLY'], [ref('R2'), 'YEARLY']] as const) {
      mockGateway(r)
      const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan }, s.token)
      await webhook('transaction.completed', await refOf(paymentId))
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

describe('API GeniusPay v2', () => {
  const V2 = 'https://api.geniuspay.ci/v2'
  const reply = (status: number, json: unknown) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  const input = { amount: 1000, reference: 'STUDY-abc', description: 'Abonnement', customer: { name: 'Awa', email: 'awa@x.fr' }, successUrl: 'https://s/ok', errorUrl: 'https://s/ko', metadata: { payment_reference: 'STUDY-abc' } }
  const original = { base: config.geniuspayBase, secret: config.geniuspaySecret }
  afterEach(() => Object.assign(config, { geniuspayBase: original.base, geniuspaySecret: original.secret }))

  it('crée le paiement : Bearer sk_, champs du contrat, checkout_url', async () => {
    Object.assign(config, { geniuspayBase: V2, geniuspaySecret: 'sk_sandbox_x' })
    expect(gateway.configured()).toBe(true) // en v2, la clé secrète suffit
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(201, { transaction_id: 'tx-1', checkout_url: 'https://pay.geniuspay.ci/c/1' }))
    expect(await gateway.createCheckout(input)).toEqual({ checkoutUrl: 'https://pay.geniuspay.ci/c/1', gatewayRef: 'tx-1' })
    const [url, init] = f.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${V2}/payments/initiate`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk_sandbox_x')
    expect(JSON.parse(String(init.body))).toMatchObject({ reference: 'STUDY-abc', amount: 1000, currency: 'XOF', country_code: 'CI', idempotency_key: 'STUDY-abc', success_url: 'https://s/ok', cancel_url: 'https://s/ko', customer_email: 'awa@x.fr' })
  })

  it('sans identifiant renvoyé, la référence du paiement fait foi ; une erreur renvoie son message', async () => {
    Object.assign(config, { geniuspayBase: V2, geniuspaySecret: 'sk_sandbox_x' })
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply(201, { checkout_url: 'https://pay/2' }))
    expect((await gateway.createCheckout(input)).gatewayRef).toBe('STUDY-abc')
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply(422, { error: 'Montant invalide' }))
    await expect(gateway.createCheckout(input)).rejects.toThrow(new GatewayError('Montant invalide'))
  })

  it('le statut se lit par notre référence', async () => {
    Object.assign(config, { geniuspayBase: V2, geniuspaySecret: 'sk_sandbox_x' })
    const f = vi.spyOn(globalThis, 'fetch').mockResolvedValue(reply(200, { status: 'completed' }))
    expect(await gateway.fetchStatus({ reference: 'STUDY-abc' })).toBe('completed')
    expect(f.mock.calls[0][0]).toBe(`${V2}/payments/STUDY-abc/status`)
  })

  it('webhook : signature « t=…,v1=… », transaction.completed, retrouve le paiement par transaction_ref', async () => {
    const s = await student()
    mockGateway(ref('V2WH'))
    const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)
    const reference = (await prisma.studentPayment.findUniqueOrThrow({ where: { id: paymentId } })).reference
    const send = (event: string, sig?: (ts: string, raw: string) => string) => {
      const raw = JSON.stringify({ event_type: event, transaction_ref: reference, status: event === 'transaction.completed' ? 'completed' : 'failed' })
      const ts = String(Math.floor(Date.now() / 1000))
      const v1 = sig ? sig(ts, raw) : crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')
      return fetch(`${app.base}/api/billing/webhook/geniuspay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-geniuspay-timestamp': ts, 'x-geniuspay-signature': `t=${ts},v1=${v1}`, 'x-geniuspay-delivery': 'd-1' }, body: raw })
    }
    expect((await send('transaction.completed', () => 'deadbeef')).status).toBe(401)
    expect((await send('transaction.completed', (_ts, raw) => crypto.createHmac('sha256', 'autre-secret').update(`${_ts}.${raw}`).digest('hex'))).status).toBe(401)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).json.limits.plan).toBe('free')
    expect((await send('transaction.completed')).status).toBe(200)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).json.limits.plan).toBe('paid')
    expect(await prisma.subscription.count({ where: { studentId: s.id } })).toBe(1)
    expect((await send('transaction.completed')).status).toBe(200) // livraison répétée : aucun doublon
    expect(await prisma.subscription.count({ where: { studentId: s.id } })).toBe(1)
  })

  it('webhook : transaction.failed marque l’échec, un événement inconnu est ignoré', async () => {
    const s = await student()
    mockGateway(ref('V2FAIL'))
    const { json: { paymentId } } = await api(app, 'POST', '/billing/checkout', { plan: 'MONTHLY' }, s.token)
    const reference = (await prisma.studentPayment.findUniqueOrThrow({ where: { id: paymentId } })).reference
    const send = (event: string) => {
      const raw = JSON.stringify({ event_type: event, transaction_ref: reference })
      const ts = String(Math.floor(Date.now() / 1000))
      return fetch(`${app.base}/api/billing/webhook/geniuspay`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-geniuspay-timestamp': ts, 'x-geniuspay-signature': `t=${ts},v1=${crypto.createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex')}` }, body: raw })
    }
    expect((await send('payout.succeeded')).status).toBe(200)
    expect((await prisma.studentPayment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING')
    expect((await send('transaction.failed')).status).toBe(200)
    expect((await prisma.studentPayment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('FAILED')
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
