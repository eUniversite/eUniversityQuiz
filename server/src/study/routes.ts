import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import multer from 'multer'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { RateLimiter } from '../security.js'
import { extractDocument } from './extract.js'
import { StudyError } from './gemini.js'
import { z } from 'zod'
import { entitlementsOf, publicLimits } from '../billing/index.js'
import { courseProgress, evolution, missionNo, recordSession, reviewQuestions, sampleRun, studentStats } from './learn.js'
import type { Analysis } from './pipeline.js'
import { wakeStudyWorker } from './queue.js'

const uploadsByStudent = new RateLimiter(6, 60 * 60_000)
const sessionsByStudent = new RateLimiter(120, 60 * 60_000)
const uploader = (mb: number) => multer({ storage: multer.memoryStorage(), limits: { fileSize: mb * 1024 * 1024, files: 1, fields: 4 } })
const uploadFree = uploader(config.freeUploadMb), uploadPaid = uploader(config.studyMaxUploadMb)
const planLimit = (res: Response, error: string) => res.status(402).json({ error, code: 'PLAN_LIMIT' })

type AH = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler

/** Routes Study (compte étudiant requis). `requireStudent` et `ah` viennent de http.ts. */
export function buildStudyRouter(requireStudent: RequestHandler, ah: AH) {
  const r = express.Router()
  r.use(requireStudent)

  const out = (c: any) => {
    const a = c.analysis as Analysis | null
    return {
      id: c.id, fileName: c.fileName, title: c.title, status: c.status, error: c.error, progress: c.progress ?? 0, step: c.step ?? null, createdAt: c.createdAt,
      summary: a?.summary ?? null,
      missions: a?.missions?.map((m) => ({ title: m.title, notions: m.notions.length, labels: m.notions.map((n) => n.label) })) ?? [],
      questionCount: c._count?.questions ?? 0,
    }
  }

  r.get('/courses', ah(async (req, res) => {
    const rows = await prisma.studyCourse.findMany({ where: { studentId: req.studentId }, orderBy: { createdAt: 'desc' }, take: 30, include: { _count: { select: { questions: true } } } })
    // Étoiles gagnées / possibles par cours (3 par mission) pour la carte d'accueil.
    const [missionCounts, results] = await Promise.all([
      prisma.studyQuestion.groupBy({ by: ['courseId', 'missionId'], where: { courseId: { in: rows.map((c) => c.id) } } }),
      prisma.studyMissionResult.findMany({ where: { studentId: req.studentId, courseId: { in: rows.map((c) => c.id) } } }),
    ])
    res.json(rows.map((c) => ({
      ...out(c),
      stars: results.filter((x) => x.courseId === c.id).reduce((n, x) => n + x.bestStars, 0),
      maxStars: missionCounts.filter((x) => x.courseId === c.id).length * 3,
    })))
  }))

  r.get('/limits', ah(async (req, res) => { res.json(publicLimits(await entitlementsOf(req.studentId!))) }))

  r.post('/courses', async (req: Request, res: Response, next: NextFunction) => {
   try {
    // Les droits sont connus avant la lecture du fichier : la limite de taille dépend du plan.
    const ent = await entitlementsOf(req.studentId!)
    const count = await prisma.studyCourse.count({ where: { studentId: req.studentId, status: { not: 'FAILED' } } }) // un import raté ne consomme pas le quota
    if (count >= ent.courses) return planLimit(res, `Le plan Découverte permet ${ent.courses} cours. Supprimez-le ou passez à l’abonnement pour en importer d’autres.`)
    ;(ent.plan === 'paid' ? uploadPaid : uploadFree).single('file')(req, res, (err: unknown) => {
      if (!err) return next()
      const code = (err as { code?: string }).code
      if (code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `Fichier trop volumineux (${ent.uploadMb} Mo maximum${ent.plan === 'free' ? ' avec le plan Découverte' : ''}).`, ...(ent.plan === 'free' ? { code: 'PLAN_LIMIT' } : {}) })
      res.status(400).json({ error: 'Import impossible.' })
    })
   } catch (e) { next(e) }
  }, ah(async (req, res) => {
    if (!config.geminiApiKey) return res.status(503).json({ error: 'La création de parcours n’est pas encore activée sur ce serveur.' })
    if (!req.file) return res.status(400).json({ error: 'Choisissez un fichier à importer.' })
    if (!uploadsByStudent.hit(req.studentId!)) return res.status(429).json({ error: 'Trop d’imports récents. Réessayez dans une heure.' })
    const busy = await prisma.studyCourse.count({ where: { studentId: req.studentId, status: { in: ['QUEUED', 'EXTRACTING', 'ANALYSING', 'CREATING'] } } })
    if (busy) return res.status(409).json({ error: 'Un cours est déjà en cours de création. Patientez quelques instants.' })

    // multer lit le nom en latin1 : on le remet en UTF-8, puis on ne garde que le nom de base.
    const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8').replace(/^.*[\\/]/, '').slice(0, 120)
    let doc
    try { doc = await extractDocument(req.file.buffer, fileName) } catch (e) {
      if (e instanceof StudyError) return res.status(422).json({ error: e.message })
      throw e
    }
    // Le texte attend dans la file (base de données) ; le worker le traite et l'efface. L'écran suit l'avancement par GET /courses/:id.
    const course = await prisma.studyCourse.create({ data: { studentId: req.studentId!, fileName, status: 'QUEUED', step: 'En attente', sourceText: doc.pages, unit: doc.unit } })
    wakeStudyWorker()
    res.status(202).json({ id: course.id, truncated: doc.truncated })
  }))

  const own = async (req: Request) => prisma.studyCourse.findFirst({ where: { id: String(req.params.id), studentId: req.studentId }, include: { _count: { select: { questions: true } } } })

  r.get('/courses/:id', ah(async (req, res) => {
    const c = await own(req)
    if (!c) return res.status(404).json({ error: 'Cours introuvable.' })
    res.json(out(c))
  }))

  // Données du jeu : même forme que lessons.js (MISSIONS, QUESTIONS) pour que le jeu 3D les lise sans changement.
  // ?mission=m2 : une seule mission ; ?review=1 : les questions dont le rappel est dû (Learn Engine).
  r.get('/courses/:id/game', ah(async (req, res) => {
    const c = await prisma.studyCourse.findFirst({ where: { id: String(req.params.id), studentId: req.studentId }, include: { questions: { orderBy: { position: 'asc' } } } })
    if (!c) return res.status(404).json({ error: 'Cours introuvable.' })
    if (c.status !== 'READY') return res.status(409).json({ error: 'Ce parcours n’est pas encore prêt.' })
    const a = c.analysis as unknown as Analysis
    const unit = a.unit === 'page' ? 'Page' : 'Section'
    const ent = await entitlementsOf(req.studentId!)
    const totalMissions = new Set(c.questions.map((q) => q.missionId)).size
    let qs = c.questions.filter((q) => missionNo(q.missionId) <= ent.missions)
    let scope = 'course'
    const mission = typeof req.query.mission === 'string' && /^m\d+$/.test(req.query.mission) ? req.query.mission : null
    if (mission && missionNo(mission) > ent.missions) return planLimit(res, `Le plan Découverte donne accès aux ${ent.missions} premières missions. Passez à l’abonnement pour continuer.`)
    if (req.query.review === '1') {
      qs = await reviewQuestions(req.studentId!, c.id, 8, ent.missions)
      scope = 'review'
      if (!qs.length) return res.status(409).json({ error: 'Rien à réviser pour le moment : revenez quand un rappel sera dû.' })
    } else if (mission) {
      qs = sampleRun(c.questions.filter((q) => q.missionId === mission))
      scope = `mission:${mission}`
      if (!qs.length) return res.status(404).json({ error: 'Mission introuvable.' })
    }
    if (scope === 'course') qs = sampleRun(qs)
    res.json({
      title: c.title, scope, plan: ent.plan, lockedMissions: Math.max(0, totalMissions - ent.missions),
      // Une mission sans question retenue n'est pas proposée.
      missions: a.missions.map((m, i) => ({ id: `m${i + 1}`, title: `Mission ${i + 1} · ${m.title}` })).filter((m) => qs.some((q) => q.missionId === m.id)),
      questions: qs.map((q) => ({
        id: q.id, missionId: q.missionId, level: q.level, source: `${unit} ${q.sourcePage ?? '?'}`, question: q.text, choices: q.choices, answer: q.answerIndex, explanation: q.explanation, excerpt: q.sourceExcerpt,
      })),
    })
  }))

  // ---- Learn Engine : fin de partie, carte du cours, profil ----
  const sessionBody = z.object({
    scope: z.string().max(20),
    answers: z.array(z.object({ questionId: z.string().max(60), chosen: z.number().int() })).min(1).max(60),
    coins: z.number().int().optional(),
    finished: z.boolean().optional(),
  })
  r.post('/courses/:id/sessions', ah(async (req, res) => {
    if (!sessionsByStudent.hit(req.studentId!)) return res.status(429).json({ error: 'Trop de parties enregistrées en peu de temps.' })
    const body = sessionBody.safeParse(req.body)
    if (!body.success) return res.status(400).json({ error: 'Partie invalide.' })
    try { res.status(201).json(await recordSession(req.studentId!, String(req.params.id), body.data, (await entitlementsOf(req.studentId!)).missions)) }
    catch (e) { if (e instanceof StudyError) return res.status(e.message === 'Cours introuvable.' ? 404 : 400).json({ error: e.message }); throw e }
  }))
  r.get('/courses/:id/progress', ah(async (req, res) => {
    try { const ent = await entitlementsOf(req.studentId!); res.json({ ...(await courseProgress(req.studentId!, String(req.params.id), ent.missions)), plan: ent.plan }) }
    catch (e) { if (e instanceof StudyError) return res.status(404).json({ error: e.message }); throw e }
  }))
  r.get('/evolution', ah(async (req, res) => { res.json(await evolution(req.studentId!)) }))
  r.get('/stats', ah(async (req, res) => { res.json(await studentStats(req.studentId!)) }))

  r.delete('/courses/:id', ah(async (req, res) => {
    const c = await own(req)
    if (!c) return res.status(404).json({ error: 'Cours introuvable.' })
    await prisma.studyCourse.delete({ where: { id: c.id } })
    res.json({ ok: true })
  }))

  return r
}
