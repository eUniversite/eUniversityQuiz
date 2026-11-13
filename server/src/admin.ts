import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { config } from './config.js'
import { RateLimiter } from './security.js'
import { prisma } from './db.js'
import { fulfil, PLANS, subscriptionOf } from './billing/index.js'
import { engine } from './engine.js'
import { gateway } from './billing/geniuspay.js'

type AH = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler

// ---- purge des données de test ----
export const PURGE_SCOPES = {
  students: { label: 'Étudiants et données Study', phrase: 'VIDER ETUDIANTS' },
  live: { label: 'Quiz et sessions Live', phrase: 'VIDER LIVE' },
  all: { label: 'Toutes les données', phrase: 'VIDER TOUT' },
} as const
type PurgeScope = keyof typeof PURGE_SCOPES
export const PURGE_MIN_DELAY_MS = 15_000       // délai imposé entre l'aperçu et la confirmation
const PURGE_TTL_MS = 5 * 60_000
const purgeChallenges = new Map<string, { adminId: string; scope: PurgeScope; at: number }>()
const purgeLimiter = new RateLimiter(6, 60 * 60_000)

async function purgeCounts(scope: PurgeScope) {
  const st = scope !== 'live', lv = scope !== 'students'
  const [students, courses, payments, subscriptions, games, quizzes, sessions, participants, answers] = await Promise.all([
    st ? prisma.student.count() : 0, st ? prisma.studyCourse.count() : 0, st ? prisma.studentPayment.count() : 0, st ? prisma.subscription.count() : 0, st ? prisma.studySession.count() : 0,
    lv ? prisma.quiz.count() : 0, lv ? prisma.session.count() : 0, lv ? prisma.participant.count() : 0, lv ? prisma.answer.count() : 0,
  ])
  const rows: [string, number][] = st ? [['Étudiants', students], ['Cours Study', courses], ['Paiements', payments], ['Abonnements', subscriptions], ['Parties jouées', games]] : []
  if (lv) rows.push(['Quiz', quizzes], ['Sessions Live', sessions], ['Participants', participants], ['Réponses', answers])
  return rows.map(([label, n]) => ({ label, n }))
}

const DAY = 86400_000
const PAGE = 25
const page = (q: unknown) => Math.max(1, Math.trunc(Number(q)) || 1)

const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10)
const loginByIp = new RateLimiter(10, 15 * 60_000)
const loginByEmail = new RateLimiter(5, 15 * 60_000)
const signAdmin = (id: string, pwdAt: number) => jwt.sign({ sub: id, role: 'admin', pwd: pwdAt }, config.jwtSecret, { expiresIn: '8h' })
const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })
const passwordSchema = z.object({ current: z.string().min(1).max(200), next: z.string().min(12, 'Mot de passe : 12 caractères minimum.').max(200) })

declare module 'express-serve-static-core' { interface Request { adminId?: string; adminEmail?: string } }

/** Journal d'audit : ne doit jamais faire échouer l'action elle-même. */
export const auditLog = (admin: { id?: string | null; email: string }, action: string, req: Request, target?: string, detail?: string) =>
  prisma.adminLog.create({ data: { adminId: admin.id ?? null, adminEmail: admin.email, action, target, detail, ip: req.ip } }).catch((e) => console.error('[admin] journal', e))

/** Backoffice : comptes administrateurs dédiés (table Admin), créés en ligne de commande (npm run admin:create). Jeton à part, 8 h, invalidé au changement de mot de passe. */
export function buildAdminRouter(ah: AH) {
  const r = express.Router()

  r.post('/login', ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body)
    const e = email.toLowerCase()
    if (!loginByIp.hit(req.ip || '?') || !loginByEmail.hit(e)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' })
    const a = await prisma.admin.findUnique({ where: { email: e } })
    const ok = await bcrypt.compare(password, a?.passwordHash ?? DUMMY_HASH) // toujours une comparaison : le temps ne révèle pas si le compte existe
    if (!a || !ok || a.disabledAt) {
      await auditLog({ id: a?.id, email: e }, 'login.echec', req, undefined, a?.disabledAt ? 'compte désactivé' : undefined)
      return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' })
    }
    await prisma.admin.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } })
    await auditLog(a, 'login', req)
    res.json({ token: signAdmin(a.id, a.passwordChangedAt ? +a.passwordChangedAt : 0), admin: { id: a.id, name: a.name, email: a.email } })
  }))

  r.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      let payload: { sub?: string; role?: string; pwd?: number }
      try { payload = jwt.verify((req.headers.authorization ?? '').replace(/^Bearer /, ''), config.jwtSecret) as typeof payload } catch { return res.status(401).json({ error: 'Connexion requise.' }) }
      if (payload.role !== 'admin' || !payload.sub) return res.status(401).json({ error: 'Connexion requise.' })
      const a = await prisma.admin.findUnique({ where: { id: payload.sub } })
      if (!a || a.disabledAt || (a.passwordChangedAt ? +a.passwordChangedAt : 0) > (payload.pwd ?? 0)) return res.status(401).json({ error: 'Connexion requise.' })
      req.adminId = a.id; req.adminEmail = a.email
      next()
    } catch (e) { next(e) }
  })
  const who = (req: Request) => ({ id: req.adminId, email: req.adminEmail! })

  r.get('/me', ah(async (req, res) => {
    const a = await prisma.admin.findUniqueOrThrow({ where: { id: req.adminId } })
    res.json({ id: a.id, name: a.name, email: a.email, lastLoginAt: a.lastLoginAt })
  }))

  r.post('/password', ah(async (req, res) => {
    const d = passwordSchema.parse(req.body)
    const a = await prisma.admin.findUniqueOrThrow({ where: { id: req.adminId } })
    if (!(await bcrypt.compare(d.current, a.passwordHash))) return res.status(400).json({ error: 'Mot de passe actuel incorrect.' })
    const now = new Date(Date.now() + 1000) // les jetons émis jusqu'ici deviennent invalides
    await prisma.admin.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(d.next, 12), passwordChangedAt: now } })
    await auditLog(a, 'mot-de-passe', req)
    res.json({ token: signAdmin(a.id, +now) })
  }))

  r.get('/logs', ah(async (req, res) => {
    const p = page(req.query.page)
    const [total, rows] = await Promise.all([prisma.adminLog.count(), prisma.adminLog.findMany({ orderBy: { createdAt: 'desc' }, skip: (p - 1) * PAGE, take: PAGE })])
    res.json({ total, page: p, pageSize: PAGE, items: rows })
  }))

  // ---- Zone dangereuse : vider les données de test. Comptes enseignants, administrateurs et journal d'audit ne sont JAMAIS supprimés. ----
  const purgeBody = z.object({ scope: z.enum(['students', 'live', 'all']), password: z.string().min(1).max(200) })
  const checkPassword = async (req: Request, password: string) => {
    const a = await prisma.admin.findUniqueOrThrow({ where: { id: req.adminId } })
    return bcrypt.compare(password, a.passwordHash)
  }

  r.get('/purge/status', (_req, res) => res.json({ enabled: !config.disableDataPurge, minDelaySec: PURGE_MIN_DELAY_MS / 1000, scopes: PURGE_SCOPES }))

  // Étape 1 : vérifie le mot de passe, montre ce qui sera supprimé et remet un jeton à usage unique.
  r.post('/purge/preview', ah(async (req, res) => {
    if (config.disableDataPurge) return res.status(403).json({ error: 'La suppression des données est désactivée sur ce serveur.' })
    const { scope, password } = purgeBody.parse(req.body)
    if (!purgeLimiter.hit(req.adminId!)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une heure.' })
    if (!(await checkPassword(req, password))) { await auditLog(who(req), 'purge.refusee', req, scope, 'mot de passe incorrect (aperçu)'); return res.status(403).json({ error: 'Mot de passe incorrect.' }) }
    const token = randomBytes(24).toString('base64url')
    for (const [k, v] of purgeChallenges) if (Date.now() - v.at > PURGE_TTL_MS) purgeChallenges.delete(k)
    purgeChallenges.set(token, { adminId: req.adminId!, scope, at: Date.now() })
    await auditLog(who(req), 'purge.apercu', req, scope)
    res.json({ token, phrase: PURGE_SCOPES[scope].phrase, minDelaySec: PURGE_MIN_DELAY_MS / 1000, expiresInSec: PURGE_TTL_MS / 1000, counts: await purgeCounts(scope) })
  }))

  // Étape 2 : mot de passe redemandé, phrase exacte, jeton valide, et délai minimal écoulé depuis l'aperçu.
  r.post('/purge/execute', ah(async (req, res) => {
    if (config.disableDataPurge) return res.status(403).json({ error: 'La suppression des données est désactivée sur ce serveur.' })
    const d = purgeBody.extend({ token: z.string().min(10).max(100), phrase: z.string().max(60) }).parse(req.body)
    if (!purgeLimiter.hit(req.adminId!)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une heure.' })
    const c = purgeChallenges.get(d.token)
    purgeChallenges.delete(d.token) // usage unique : toute tentative, réussie ou non, consomme le jeton
    if (!c || c.adminId !== req.adminId || c.scope !== d.scope || Date.now() - c.at > PURGE_TTL_MS) return res.status(400).json({ error: 'Demande expirée. Recommencez depuis le début.' })
    if (Date.now() - c.at < PURGE_MIN_DELAY_MS) return res.status(400).json({ error: 'Confirmation trop rapide. Recommencez et prenez le temps de relire.' })
    if (d.phrase !== PURGE_SCOPES[d.scope].phrase) return res.status(400).json({ error: 'La phrase de confirmation est incorrecte.' })
    if (!(await checkPassword(req, d.password))) { await auditLog(who(req), 'purge.refusee', req, d.scope, 'mot de passe incorrect (confirmation)'); return res.status(403).json({ error: 'Mot de passe incorrect.' }) }

    const counts = await purgeCounts(d.scope)
    await auditLog(who(req), 'purge', req, d.scope, counts.map((x) => `${x.label}: ${x.n}`).join(', ')) // écrit AVANT la suppression
    await prisma.$transaction(async (tx) => {
      if (d.scope !== 'live') { await tx.ssoCode.deleteMany(); await tx.student.deleteMany() }      // les cascades emportent cours, questions, parties, paiements, abonnements
      if (d.scope !== 'students') { await tx.quiz.deleteMany(); await tx.session.deleteMany() }       // les cascades emportent questions, participants, réponses
    }, { timeout: 120_000 })
    if (d.scope !== 'students') engine.resetCache()
    res.json({ ok: true, counts })
  }))

  r.get('/stats', ah(async (_req, res) => {
    const now = new Date(), d7 = new Date(+now - 7 * DAY), d30 = new Date(+now - 30 * DAY), d14 = new Date(+now - 14 * DAY)
    const [students, new7, blocked, active, courses, readyCourses, failedCourses, pending, rev, rev30, signups, plays] = await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { createdAt: { gte: d7 } } }),
      prisma.student.count({ where: { blockedAt: { not: null } } }),
      prisma.subscription.findMany({ where: { endsAt: { gt: now } }, distinct: ['studentId'], select: { studentId: true, plan: true } }),
      prisma.studyCourse.count(),
      prisma.studyCourse.count({ where: { status: 'READY' } }),
      prisma.studyCourse.count({ where: { status: 'FAILED' } }),
      prisma.studentPayment.count({ where: { status: 'PENDING' } }),
      prisma.studentPayment.aggregate({ where: { status: 'COMPLETED', amount: { gt: 0 } }, _sum: { amount: true }, _count: true }),
      prisma.studentPayment.aggregate({ where: { status: 'COMPLETED', amount: { gt: 0 }, paidAt: { gte: d30 } }, _sum: { amount: true } }),
      prisma.student.findMany({ where: { createdAt: { gte: d14 } }, select: { createdAt: true } }),
      prisma.studySession.count({ where: { createdAt: { gte: d7 } } }),
    ])
    const perDay = new Map<string, number>()
    for (let i = 13; i >= 0; i--) perDay.set(new Date(+now - i * DAY).toISOString().slice(0, 10), 0)
    for (const s of signups) { const k = s.createdAt.toISOString().slice(0, 10); if (perDay.has(k)) perDay.set(k, perDay.get(k)! + 1) }
    res.json({
      students, newThisWeek: new7, blocked, subscribers: active.length, free: students - active.length,
      monthly: active.filter((a) => a.plan === 'MONTHLY').length, yearly: active.filter((a) => a.plan === 'YEARLY').length,
      courses, readyCourses, failedCourses, pendingPayments: pending, gamesThisWeek: plays,
      revenue: rev._sum.amount ?? 0, payments: rev._count, revenue30: rev30._sum.amount ?? 0,
      signups: [...perDay].map(([day, n]) => ({ day, n })),
    })
  }))

  r.get('/students', ah(async (req, res) => {
    const q = String(req.query.q ?? '').trim().slice(0, 100)
    const where = q ? { OR: [{ email: { contains: q, mode: 'insensitive' as const } }, { name: { contains: q, mode: 'insensitive' as const } }] } : {}
    const p = page(req.query.page)
    const [total, rows] = await Promise.all([
      prisma.student.count({ where }),
      prisma.student.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * PAGE, take: PAGE,
        select: { id: true, email: true, name: true, createdAt: true, googleId: true, passwordHash: true, blockedAt: true, _count: { select: { courses: true } } } }),
    ])
    const subs = await prisma.subscription.findMany({ where: { studentId: { in: rows.map((s) => s.id) }, endsAt: { gt: new Date() } }, orderBy: { endsAt: 'desc' } })
    res.json({
      total, page: p, pageSize: PAGE,
      items: rows.map((s) => {
        const sub = subs.find((x) => x.studentId === s.id)
        return { id: s.id, email: s.email, name: s.name, createdAt: s.createdAt, courses: s._count.courses, google: !!s.googleId, password: !!s.passwordHash, blocked: !!s.blockedAt, plan: sub ? sub.plan : null, endsAt: sub?.endsAt ?? null }
      }),
    })
  }))

  r.post('/students/:id/block', ah(async (req, res) => {
    const { blocked } = z.object({ blocked: z.boolean() }).parse(req.body)
    const done = await prisma.student.updateMany({ where: { id: String(req.params.id) }, data: { blockedAt: blocked ? new Date() : null } })
    if (!done.count) return res.status(404).json({ error: 'Étudiant introuvable.' })
    await auditLog(who(req), blocked ? 'etudiant.suspendre' : 'etudiant.reactiver', req, String(req.params.id))
    res.json({ ok: true })
  }))

  // Abonnement offert : un paiement à 0 FCFA confirmé par la même fonction que les vrais paiements (périodes qui s'enchaînent).
  r.post('/students/:id/grant', ah(async (req, res) => {
    const { plan } = z.object({ plan: z.enum(['MONTHLY', 'YEARLY']) }).parse(req.body)
    const s = await prisma.student.findUnique({ where: { id: String(req.params.id) } })
    if (!s) return res.status(404).json({ error: 'Étudiant introuvable.' })
    const p = await prisma.studentPayment.create({ data: { studentId: s.id, plan, amount: 0, reference: `GRANT-${randomBytes(6).toString('hex')}` } })
    await fulfil(p.id)
    await auditLog(who(req), 'abonnement.offrir', req, s.email, `${plan} (${PLANS[plan].months} mois)`)
    res.status(201).json({ subscription: await subscriptionOf(s.id) })
  }))

  r.get('/payments', ah(async (req, res) => {
    const status = z.enum(['PENDING', 'COMPLETED', 'FAILED']).optional().safeParse(req.query.status || undefined)
    const where = status.success && status.data ? { status: status.data } : {}
    const p = page(req.query.page)
    const [total, rows] = await Promise.all([
      prisma.studentPayment.count({ where }),
      prisma.studentPayment.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (p - 1) * PAGE, take: PAGE, include: { student: { select: { email: true } } } }),
    ])
    res.json({ total, page: p, pageSize: PAGE, items: rows.map((x) => ({ id: x.id, email: x.student.email, plan: x.plan, amount: x.amount, status: x.status, reference: x.reference, gatewayRef: x.gatewayRef, createdAt: x.createdAt, paidAt: x.paidAt, offered: x.amount === 0 })) })
  }))

  // Vérification immédiate chez GeniusPay (sans attendre le délai de grâce du webhook) d'un paiement bloqué en attente.
  r.post('/payments/:id/check', ah(async (req, res) => {
    const p = await prisma.studentPayment.findUnique({ where: { id: String(req.params.id) } })
    if (!p) return res.status(404).json({ error: 'Paiement introuvable.' })
    if (p.status !== 'PENDING') return res.json({ status: p.status })
    if (!p.gatewayRef || !gateway.configured()) return res.status(409).json({ error: 'Ce paiement ne peut pas être vérifié chez GeniusPay.' })
    const remote = await gateway.fetchStatus(p.gatewayRef)
    if (!remote) return res.status(502).json({ error: 'GeniusPay ne répond pas.' })
    await auditLog(who(req), 'paiement.verifier', req, p.reference, `GeniusPay : ${remote}`)
    if (remote === 'completed') await fulfil(p.id)
    else if (['failed', 'cancelled', 'expired'].includes(remote)) await prisma.studentPayment.updateMany({ where: { id: p.id, status: 'PENDING' }, data: { status: 'FAILED' } })
    res.json({ status: (await prisma.studentPayment.findUnique({ where: { id: p.id } }))!.status, remote })
  }))

  r.get('/courses', ah(async (req, res) => {
    const failed = req.query.status === 'FAILED'
    const rows = await prisma.studyCourse.findMany({ where: failed ? { status: 'FAILED' } : {}, orderBy: { createdAt: 'desc' }, take: 50, include: { student: { select: { email: true } }, _count: { select: { questions: true } } } })
    res.json(rows.map((c) => ({ id: c.id, email: c.student.email, fileName: c.fileName, title: c.title, status: c.status, error: c.error, questions: c._count.questions, createdAt: c.createdAt })))
  }))

  return r
}

/**
 * Crée le premier administrateur depuis ADMIN_BOOTSTRAP_EMAIL / ADMIN_BOOTSTRAP_PASSWORD (utile sans accès terminal).
 * Un compte existant n'est pas modifié (le mot de passe changé depuis le backoffice reste valable), sauf avec ADMIN_BOOTSTRAP_RESET=1.
 */
export async function bootstrapAdmin(): Promise<'created' | 'reset' | 'exists' | 'skipped'> {
  const { adminBootstrapEmail: email, adminBootstrapPassword: password, adminBootstrapReset: reset } = config
  if (!email && !password) return 'skipped'
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12) {
    console.error('[admin] ADMIN_BOOTSTRAP_EMAIL (adresse valide) et ADMIN_BOOTSTRAP_PASSWORD (12 caractères minimum) sont requis : administrateur non créé.')
    return 'skipped'
  }
  const hash = await bcrypt.hash(password, 12)
  const a = await prisma.admin.findUnique({ where: { email } })
  if (!a) { await prisma.admin.create({ data: { email, name: email.split('@')[0], passwordHash: hash } }); console.log(`[admin] administrateur créé : ${email}`); return 'created' }
  if (!reset) return 'exists'
  await prisma.admin.update({ where: { id: a.id }, data: { passwordHash: hash, passwordChangedAt: new Date(Date.now() + 1000), disabledAt: null } })
  console.log(`[admin] mot de passe réinitialisé : ${email} (retirez ADMIN_BOOTSTRAP_RESET)`)
  return 'reset'
}
