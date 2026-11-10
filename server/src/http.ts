import express, { type NextFunction, type Request, type Response } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { ZodError } from 'zod'
import { config } from './config.js'
import { prisma } from './db.js'
import { engine, EngineError } from './engine.js'
import { RateLimiter, normalizeCode, hashToken, newToken } from './security.js'
import { mailer, sendResetMail } from './mailer.js'
import { emailSchema, joinSchema, loginSchema, quizSchema, resetSchema, signupSchema, studentSignupSchema } from './validation.js'
import { rankBy } from './scoring.js'
import { buildStudyRouter } from './study/routes.js'
import { buildBillingRouter, geniuspayWebhook } from './billing/routes.js'
import { subscriptionOf } from './billing/index.js'

declare module 'express-serve-static-core' { interface Request { teacherId?: string; teacherPwdAt?: number; studentId?: string } }

const signTeacher = (id: string, pwdAt: number) => jwt.sign({ sub: id, pwd: pwdAt }, config.jwtSecret, { expiresIn: '12h' })

/** Vérifie le JWT, le compte et l'invalidation après changement de mot de passe. */
export async function authenticateTeacher(token: string | undefined): Promise<{ id: string; pwdAt: number } | null> {
  if (!token) return null
  let payload: { sub?: string; pwd?: number; role?: string }
  try { payload = jwt.verify(token, config.jwtSecret) as typeof payload } catch { return null }
  if (!payload.sub || payload.role === 'student') return null
  const t = await prisma.teacher.findUnique({ where: { id: payload.sub }, select: { id: true, passwordChangedAt: true } }).catch(() => null)
  if (!t) return null
  const pwdAt = t.passwordChangedAt ? +t.passwordChangedAt : 0
  if (pwdAt > (payload.pwd ?? 0)) return null // jeton émis avant le dernier changement de mot de passe
  return { id: t.id, pwdAt }
}

const signStudent = (id: string) => jwt.sign({ sub: id, role: 'student' }, config.jwtSecret, { expiresIn: '30d' })

/** Jeton étudiant : doit porter le rôle « student » (un jeton enseignant n'ouvre jamais l'espace étudiant). */
export async function authenticateStudent(token: string | undefined): Promise<{ id: string } | null> {
  if (!token) return null
  let payload: { sub?: string; role?: string }
  try { payload = jwt.verify(token, config.jwtSecret) as typeof payload } catch { return null }
  if (!payload.sub || payload.role !== 'student') return null
  const s = await prisma.student.findUnique({ where: { id: payload.sub }, select: { id: true } }).catch(() => null)
  return s ? { id: s.id } : null
}

const loginByIp = new RateLimiter(20, 15 * 60_000)
const loginByEmail = new RateLimiter(8, 15 * 60_000)
const signupByIp = new RateLimiter(10, 60 * 60_000)
const actionByIp = new RateLimiter(15, 60 * 60_000)
const codeFailures = new RateLimiter(30, 10 * 60_000)
const joinAttempts = new RateLimiter(600, 60_000)
const DUMMY_HASH = bcrypt.hashSync('dummy-password', 10)

const ah = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next)

async function requireTeacher(req: Request, res: Response, next: NextFunction) {
  const t = await authenticateTeacher(req.headers.authorization?.replace(/^Bearer /, ''))
  if (!t) return res.status(401).json({ error: 'Connexion requise.' })
  req.teacherId = t.id; req.teacherPwdAt = t.pwdAt
  next()
}

async function requireStudent(req: Request, res: Response, next: NextFunction) {
  const s = await authenticateStudent(req.headers.authorization?.replace(/^Bearer /, ''))
  if (!s) return res.status(401).json({ error: 'Connexion requise.' })
  req.studentId = s.id
  next()
}

/** Jeton à usage unique (vérification e-mail / réinitialisation). Exporté pour les tests. */
export const issueActionToken = async (teacherId: string, purpose: 'verify' | 'reset', ttlMs: number) => {
  const token = newToken()
  await prisma.actionToken.create({ data: { teacherId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlMs) } })
  return token
}

export function buildRouter() {
  const r = express.Router()

  r.get('/health', ah(async (_req, res) => { await prisma.$queryRaw`SELECT 1`; res.json({ ok: true }) }))
  r.get('/config', (_req, res) => res.json({ publicUrl: config.publicUrl }))

  // ---- authentification professeur ----
  r.post('/auth/login', ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body)
    const e = email.toLowerCase()
    if (!loginByIp.hit(req.ip || '?') || !loginByEmail.hit(e)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' })
    const t = await prisma.teacher.findUnique({ where: { email: e } })
    const ok = await bcrypt.compare(password, t?.passwordHash ?? DUMMY_HASH)
    if (!t || !ok) return res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' })
    const pwdAt = t.passwordChangedAt ? +t.passwordChangedAt : 0
    res.json({ token: signTeacher(t.id, pwdAt), teacher: { id: t.id, name: t.name, email: t.email, emailVerifiedAt: t.emailVerifiedAt } })
  }))
  r.get('/auth/me', requireTeacher, ah(async (req, res) => {
    const t = await prisma.teacher.findUnique({ where: { id: req.teacherId } })
    if (!t) return res.status(401).json({ error: 'Connexion requise.' })
    res.json({ id: t.id, name: t.name, email: t.email, mailEnabled: mailer.enabled })
  }))

  const consumeActionToken = async (purpose: 'verify' | 'reset', token: string) => {
    const t = await prisma.actionToken.findUnique({ where: { tokenHash: hashToken(token) } })
    if (!t || t.purpose !== purpose || t.usedAt || t.expiresAt < new Date()) return null
    await prisma.actionToken.update({ where: { id: t.id }, data: { usedAt: new Date() } })
    return t
  }
  const resetUrl = (token: string) => `${config.publicUrl}/enseignant/nouveau-mot-de-passe?token=${token}`

  r.post('/auth/signup', ah(async (req, res) => {
    if (!signupByIp.hit(req.ip || '?')) return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' })
    const d = signupSchema.parse(req.body)
    const exists = await prisma.teacher.findUnique({ where: { email: d.email } })
    if (exists) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.', fields: [{ path: 'email', message: 'Un compte existe déjà avec cette adresse e-mail.' }] })
    const t = await prisma.teacher.create({ data: { email: d.email, name: d.name, passwordHash: await bcrypt.hash(d.password, 12) } })
    res.status(201).json({ token: signTeacher(t.id, 0), teacher: { id: t.id, name: t.name, email: t.email } })
  }))
  r.post('/auth/forgot', ah(async (req, res) => {
    const { email } = emailSchema.parse(req.body)
    if (!actionByIp.hit(req.ip || '?') || !loginByEmail.hit(email)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' })
    const t = await prisma.teacher.findUnique({ where: { email } })
    if (t && mailer.enabled) {
      const token = await issueActionToken(t.id, 'reset', 3600_000)
      await sendResetMail(t.email, t.name, resetUrl(token)).catch((e) => console.error('reset mail:', e))
    }
    res.json({ ok: true, mailSent: mailer.enabled })
  }))
  r.post('/auth/reset', ah(async (req, res) => {
    const d = resetSchema.parse(req.body)
    if (!actionByIp.hit(req.ip || '?')) return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' })
    const t = await consumeActionToken('reset', d.token)
    if (!t) return res.status(400).json({ error: 'Lien invalide ou expiré. Demandez un nouveau lien de réinitialisation.' })
    await prisma.$transaction([
      prisma.teacher.update({ where: { id: t.teacherId }, data: { passwordHash: await bcrypt.hash(d.password, 12), passwordChangedAt: new Date() } }),
      prisma.actionToken.deleteMany({ where: { teacherId: t.teacherId, purpose: 'reset', usedAt: null } }),
    ])
    res.json({ ok: true })
  }))

  // ---- connexion unifiée : le serveur reconnaît le profil (enseignant ou étudiant) ----
  r.post('/session/login', ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body)
    const e = email.toLowerCase()
    if (!loginByIp.hit(req.ip || '?') || !loginByEmail.hit(e)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans quelques minutes.' })
    const [t, s] = await Promise.all([prisma.teacher.findUnique({ where: { email: e } }), prisma.student.findUnique({ where: { email: e } })])
    // Deux comparaisons à chaque fois : le temps de réponse ne révèle ni le profil ni l'existence du compte.
    const [okT, okS] = await Promise.all([bcrypt.compare(password, t?.passwordHash ?? DUMMY_HASH), bcrypt.compare(password, s?.passwordHash ?? DUMMY_HASH)])
    if (t && okT) {
      const pwdAt = t.passwordChangedAt ? +t.passwordChangedAt : 0
      return res.json({ role: 'teacher', token: signTeacher(t.id, pwdAt), user: { id: t.id, name: t.name, email: t.email } })
    }
    if (s && okS) return res.json({ role: 'student', token: signStudent(s.id), user: { id: s.id, name: s.name, email: s.email } })
    res.status(401).json({ error: 'E-mail ou mot de passe incorrect.' })
  }))

  // ---- compte étudiant (Study) : e-mail + PIN à 6 chiffres (le PIN tient lieu de mot de passe) ----
  const nameFromEmail = (email: string) => {
    const n = email.split('@')[0].replace(/[._+-]+/g, ' ').replace(/\d+/g, '').trim() || 'Étudiant'
    return n.replace(/\b\p{L}/gu, (c) => c.toUpperCase()).slice(0, 50)
  }
  r.post('/student/signup', ah(async (req, res) => {
    if (!signupByIp.hit(req.ip || '?')) return res.status(429).json({ error: 'Trop de tentatives. Réessayez plus tard.' })
    const d = studentSignupSchema.parse(req.body)
    const exists = await prisma.student.findUnique({ where: { email: d.email } })
    if (exists) return res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.', fields: [{ path: 'email', message: 'Un compte existe déjà avec cette adresse e-mail.' }] })
    const s = await prisma.student.create({ data: { email: d.email, name: nameFromEmail(d.email), passwordHash: await bcrypt.hash(d.pin, 12) } })
    res.status(201).json({ role: 'student', token: signStudent(s.id), user: { id: s.id, name: s.name, email: s.email } })
  }))
  r.get('/student/me', requireStudent, ah(async (req, res) => {
    const s = await prisma.student.findUnique({ where: { id: req.studentId } })
    if (!s) return res.status(401).json({ error: 'Connexion requise.' })
    res.json({ id: s.id, name: s.name, email: s.email, subscription: await subscriptionOf(s.id) })
  }))

  // ---- abonnement Study (GeniusPay) ----
  r.use('/billing', buildBillingRouter(requireStudent, ah))
  r.post('/billing/webhook/geniuspay', geniuspayWebhook)

  r.use('/study', buildStudyRouter(requireStudent, ah))

  // ---- quiz ----
  const quizOut = (q: any) => ({
    id: q.id, title: q.title, description: q.description, isDemo: q.isDemo, updatedAt: q.updatedAt,
    questionCount: q._count?.questions, questions: q.questions?.map((x: any) => ({ id: x.id, text: x.text, options: x.options, correctIndex: x.correctIndex, durationSec: x.durationSec, explanation: x.explanation })),
  })
  const own = (req: Request) => ({ id: String(req.params.id), teacherId: req.teacherId! })

  r.get('/quizzes', requireTeacher, ah(async (req, res) => {
    const list = await prisma.quiz.findMany({ where: { teacherId: req.teacherId }, orderBy: { updatedAt: 'desc' }, include: { _count: { select: { questions: true } } } })
    res.json(list.map(quizOut))
  }))
  r.get('/quizzes/:id', requireTeacher, ah(async (req, res) => {
    const q = await prisma.quiz.findFirst({ where: own(req), include: { questions: { orderBy: { position: 'asc' } } } })
    q ? res.json(quizOut(q)) : res.status(404).json({ error: 'Quiz introuvable.' })
  }))
  const toCreate = (d: ReturnType<typeof quizSchema.parse>) => d.questions.map((q, i) => ({ position: i, text: q.text, options: q.options, correctIndex: q.correctIndex, durationSec: q.durationSec, explanation: q.explanation || null }))
  r.post('/quizzes', requireTeacher, ah(async (req, res) => {
    const d = quizSchema.parse(req.body)
    const q = await prisma.quiz.create({ data: { teacherId: req.teacherId!, title: d.title, description: d.description || null, questions: { create: toCreate(d) } } })
    res.status(201).json({ id: q.id })
  }))
  r.put('/quizzes/:id', requireTeacher, ah(async (req, res) => {
    const d = quizSchema.parse(req.body)
    const ex = await prisma.quiz.findFirst({ where: own(req), select: { id: true } })
    if (!ex) return res.status(404).json({ error: 'Quiz introuvable.' })
    await prisma.$transaction([
      prisma.quizQuestion.deleteMany({ where: { quizId: ex.id } }),
      prisma.quiz.update({ where: { id: ex.id }, data: { title: d.title, description: d.description || null, questions: { create: toCreate(d) } } }),
    ])
    res.json({ id: ex.id })
  }))
  r.post('/quizzes/:id/duplicate', requireTeacher, ah(async (req, res) => {
    const q = await prisma.quiz.findFirst({ where: own(req), include: { questions: { orderBy: { position: 'asc' } } } })
    if (!q) return res.status(404).json({ error: 'Quiz introuvable.' })
    const c = await prisma.quiz.create({ data: { teacherId: q.teacherId, title: `${q.title} (copie)`, description: q.description, questions: { create: q.questions.map((x, i) => ({ position: i, text: x.text, options: x.options as string[], correctIndex: x.correctIndex, durationSec: x.durationSec, explanation: x.explanation })) } } })
    res.status(201).json({ id: c.id })
  }))
  r.delete('/quizzes/:id', requireTeacher, ah(async (req, res) => {
    const n = await prisma.quiz.deleteMany({ where: own(req) })
    n.count ? res.json({ ok: true }) : res.status(404).json({ error: 'Quiz introuvable.' })
  }))

  // ---- sessions ----
  r.get('/sessions', requireTeacher, ah(async (req, res) => {
    const list = await prisma.session.findMany({ where: { teacherId: req.teacherId }, orderBy: { createdAt: 'desc' }, take: 20, include: { _count: { select: { participants: true, questions: true } } } })
    res.json(list.map((s) => ({ id: s.id, code: s.code, quizTitle: s.quizTitle, status: s.status, createdAt: s.createdAt, endedAt: s.endedAt, participants: s._count.participants, questions: s._count.questions })))
  }))
  r.post('/sessions', requireTeacher, ah(async (req, res) => {
    const s = await engine.createSession(req.teacherId!, String(req.body?.quizId ?? ''))
    res.status(201).json({ id: s.id, code: s.code })
  }))
  r.get('/sessions/:id', requireTeacher, ah(async (req, res) => {
    const s = await prisma.session.findFirst({ where: { id: String(req.params.id), teacherId: req.teacherId } })
    s ? res.json({ id: s.id, code: s.code, quizTitle: s.quizTitle, status: s.status }) : res.status(404).json({ error: 'Session introuvable.' })
  }))

  async function results(req: Request) {
    const s = await prisma.session.findFirst({
      where: { id: String(req.params.id), teacherId: req.teacherId },
      include: { questions: { orderBy: { position: 'asc' }, include: { answers: { select: { participantId: true, choiceIndex: true, correct: true, points: true } } } }, participants: true },
    })
    if (!s) return null
    const correctBy = new Map<string, number>()
    for (const q of s.questions) for (const a of q.answers) if (a.correct) correctBy.set(a.participantId, (correctBy.get(a.participantId) ?? 0) + 1)
    const ranking = rankBy(s.participants, (p) => p.totalScore).map(({ rank, item: p }) => ({ rank, id: p.id, fullName: p.fullName, nickname: p.nickname, score: p.totalScore, correct: correctBy.get(p.id) ?? 0 }))
    const questions = s.questions.map((q) => {
      const opts = q.options as string[]
      const closed = q.status === 'CLOSED'
      return {
        position: q.position, text: q.text, options: opts, status: q.status,
        correctIndex: closed ? q.correctIndex : null,
        poll: q.correctIndex === null,
        distribution: opts.map((_, i) => q.answers.filter((a) => a.choiceIndex === i).length),
        answered: q.answers.length, correct: q.answers.filter((a) => a.correct).length,
      }
    })
    return { id: s.id, code: s.code, quizTitle: s.quizTitle, status: s.status, createdAt: s.createdAt, endedAt: s.endedAt, participants: ranking, questions }
  }
  r.get('/sessions/:id/results', requireTeacher, ah(async (req, res) => {
    const d = await results(req)
    d ? res.json(d) : res.status(404).json({ error: 'Session introuvable.' })
  }))
  r.get('/sessions/:id/results.csv', requireTeacher, ah(async (req, res) => {
    const d = await results(req)
    if (!d) return res.status(404).json({ error: 'Session introuvable.' })
    const esc = (v: string | number) => { let s = String(v); if (/^[=+\-@]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"` }
    const lines = ['Rang;Pseudo;Nom complet;Points;Bonnes réponses', ...d.participants.map((p) => [p.rank, esc(p.nickname), esc(p.fullName), p.score, p.correct].join(';'))]
    res.type('text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="resultats-${d.code}.csv"`).send('\ufeff' + lines.join('\n'))
  }))
  r.post('/sessions/:id/participants/:pid/reset', requireTeacher, ah(async (req, res) => {
    await engine.resetParticipant(String(req.params.id), req.teacherId!, String(req.params.pid))
    res.json({ ok: true })
  }))

  // ---- public étudiant ----
  r.get('/public/sessions/:code', ah(async (req, res) => {
    const ip = req.ip || '?'
    if (codeFailures.count(ip) >= 30) return res.status(429).json({ error: 'Trop d’essais. Patientez quelques minutes.' })
    const s = await engine.lookupCode(normalizeCode(String(req.params.code)))
    if (!s) { codeFailures.hit(ip); return res.status(404).json({ error: 'Code inconnu. Vérifiez-le et réessayez.' }) }
    res.json({ code: s.code, quizTitle: s.quizTitle, ended: s.status === 'ENDED' })
  }))
  r.post('/public/join', ah(async (req, res) => {
    const ip = req.ip || '?'
    if (codeFailures.count(ip) >= 30 || !joinAttempts.hit(ip)) return res.status(429).json({ error: 'Trop d’essais. Patientez quelques minutes.' })
    const d = joinSchema.parse(req.body)
    try {
      res.status(201).json(await engine.join(normalizeCode(d.code), d.fullName, d.nickname))
    } catch (e) {
      if (e instanceof EngineError && e.code === 'NO_SESSION') codeFailures.hit(ip)
      throw e
    }
  }))

  return r
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    const fields = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
    return res.status(400).json({ error: fields[0]?.message ?? 'Données invalides.', fields })
  }
  if (err instanceof EngineError) return res.status(err.http).json({ error: err.message, code: err.code })
  if ((err as any)?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' })
  console.error(err)
  res.status(500).json({ error: 'Une erreur est survenue. Réessayez.' })
}
