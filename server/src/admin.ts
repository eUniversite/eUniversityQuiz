import { randomBytes } from 'node:crypto'
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { z } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import { fulfil, PLANS, subscriptionOf } from './billing/index.js'
import { gateway } from './billing/geniuspay.js'

type AH = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler

const DAY = 86400_000
const PAGE = 25
const page = (q: unknown) => Math.max(1, Math.trunc(Number(q)) || 1)

/** Backoffice. Réservé aux enseignants dont l'e-mail figure dans ADMIN_EMAILS ET est vérifié (sinon quiconque s'inscrirait avec cette adresse deviendrait admin). */
export function buildAdminRouter(requireTeacher: RequestHandler, ah: AH) {
  const r = express.Router()
  r.use(requireTeacher)
  r.use(async (req: Request, res: Response, next: NextFunction) => {
    try {
      const t = await prisma.teacher.findUnique({ where: { id: req.teacherId }, select: { email: true, emailVerifiedAt: true } })
      if (!t || !t.emailVerifiedAt || !config.adminEmails.includes(t.email.toLowerCase())) return res.status(403).json({ error: 'Accès réservé aux administrateurs.' })
      next()
    } catch (e) { next(e) }
  })

  r.get('/me', (_req, res) => res.json({ admin: true }))

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
    res.json({ ok: true })
  }))

  // Abonnement offert : un paiement à 0 FCFA confirmé par la même fonction que les vrais paiements (périodes qui s'enchaînent).
  r.post('/students/:id/grant', ah(async (req, res) => {
    const { plan } = z.object({ plan: z.enum(['MONTHLY', 'YEARLY']) }).parse(req.body)
    const s = await prisma.student.findUnique({ where: { id: String(req.params.id) } })
    if (!s) return res.status(404).json({ error: 'Étudiant introuvable.' })
    const p = await prisma.studentPayment.create({ data: { studentId: s.id, plan, amount: 0, reference: `GRANT-${randomBytes(6).toString('hex')}` } })
    await fulfil(p.id)
    console.log(`[admin] abonnement ${plan} offert à ${s.email} (${PLANS[plan].months} mois)`)
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
