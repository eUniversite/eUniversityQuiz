import { randomInt, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { z } from 'zod'
import { config } from '../config.js'
import { prisma } from '../db.js'
import { ANALYSE_SCHEMA, CREATE_SCHEMA, VERIFY_SCHEMA, generateJson, StudyError } from './gemini.js'
import { SYSTEM_ANALYSE, SYSTEM_CREATE, SYSTEM_VERIFY, userAnalyse, userCreateMission, userVerify } from './prompts.js'

const analysisSchema = z.object({
  usable: z.boolean(),
  unusableReason: z.string().optional(),
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().max(600).default(''),
  missions: z.array(z.object({
    title: z.string().trim().min(1).max(120),
    startPage: z.number().int().optional(),
    endPage: z.number().int().optional(),
    notions: z.array(z.object({ label: z.string().trim().max(160), page: z.number().int(), excerpt: z.string().trim().max(400) })).max(10),
  })).max(6),
})
type RawMission = z.infer<typeof analysisSchema>['missions'][number]
export interface Mission { title: string; startPage: number; endPage: number; notions: RawMission['notions'] }
export type Analysis = Omit<z.infer<typeof analysisSchema>, 'missions'> & { missions: Mission[]; unit?: 'page' | 'section' }

const questionSchema = z.object({
  notionIndex: z.number().int().min(0).max(9),
  level: z.number().int().min(1).max(3),
  question: z.string().trim().min(8).max(300),
  choices: z.array(z.string().trim().min(1).max(120)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().trim().min(1).max(450),
  sourcePage: z.number().int(),
  sourceExcerpt: z.string().trim().min(10).max(500),
})
type RawQuestion = z.infer<typeof questionSchema>

// ---- découpage en missions ----------------------------------------------------
/**
 * Le modèle donne une plage de pages par mission. On ne lui fait pas confiance aveuglément : bornes ramenées dans le document,
 * plage déduite des notions si elle manque, répartition égale en dernier recours.
 */
export function normalizeMissions(missions: RawMission[], pageCount: number): Mission[] {
  const clamp = (n: number) => Math.min(Math.max(Math.trunc(n), 1), pageCount)
  return missions.map((m, i) => {
    let start = m.startPage, end = m.endPage
    if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      const pg = m.notions.map((n) => n.page).filter((p) => p >= 1 && p <= pageCount)
      if (pg.length) { start = Math.min(...pg); end = Math.max(...pg) } else {
        start = Math.floor((i * pageCount) / missions.length) + 1
        end = Math.floor(((i + 1) * pageCount) / missions.length)
      }
    }
    const s = clamp(start), e = Math.max(s, clamp(end))
    return { title: m.title, startPage: s, endPage: e, notions: m.notions }
  })
}

// ---- contrôles qualité ------------------------------------------------------
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/** L'extrait cité doit venir du texte : exact, ou (tolérance OCR/mise en page) au moins 70 % de ses suites de 4 mots. Renvoie l'indice (1-based) dans `pages`. */
function excerptPage(excerpt: string, pages: string[], hint: number): number | null {
  const e = norm(excerpt)
  if (!e) return null
  const normPages = pages.map(norm)
  const order = [hint - 1, ...normPages.keys()].filter((i, k, a) => i >= 0 && i < pages.length && a.indexOf(i) === k)
  for (const i of order) if (normPages[i].includes(e)) return i + 1
  const w = e.split(' ')
  if (w.length < 5) return null
  const grams: string[] = []
  for (let i = 0; i + 4 <= w.length; i++) grams.push(w.slice(i, i + 4).join(' '))
  const hay = normPages.join(' ')
  return grams.filter((g) => hay.includes(g)).length / grams.length >= 0.7 ? Math.min(Math.max(hint, 1), pages.length) : null
}

export type ValidQuestion = RawQuestion

/** Contrôles faits par le code, sans le modèle. `pages` = texte de la mission, `firstPage` = numéro de sa première page dans le document. */
export function validateQuestions(raw: unknown[], pages: string[], firstPage: number, notionCount: number, seen = new Set<string>()): { kept: ValidQuestion[]; dropped: number } {
  const kept: ValidQuestion[] = []
  const slots = new Set<string>()                               // une seule question par notion et par niveau
  for (const item of raw) {
    const q = questionSchema.safeParse(item)
    if (!q.success) continue
    const d = q.data
    if (d.notionIndex >= notionCount || slots.has(`${d.notionIndex}:${d.level}`)) continue
    const choices = d.choices.map(norm)
    if (new Set(choices).size !== 4) continue
    if (/^(toutes|aucune)\b/.test(choices[d.answerIndex]) || choices.some((c) => /^(toutes les|aucune des)\b/.test(c))) continue
    const key = norm(d.question)
    if (seen.has(key)) continue
    const page = excerptPage(d.sourceExcerpt, pages, d.sourcePage - firstPage + 1)
    if (page === null) continue
    seen.add(key)
    slots.add(`${d.notionIndex}:${d.level}`)
    kept.push({ ...d, sourcePage: page + firstPage - 1 })
  }
  return { kept, dropped: raw.length - kept.length }
}

/** Relecture indépendante : une question est gardée si le modèle, sans connaître la réponse attendue, retrouve la même, la juge établie par le cours et non ambiguë. */
export function applyVerdicts(questions: ValidQuestion[], results: unknown): ValidQuestion[] {
  const list = Array.isArray(results) ? (results as any[]) : []
  return questions.filter((q, i) => {
    const r = list.find((x) => x?.index === i)
    return !!r && r.answerIndex === q.answerIndex && r.supported === true && r.ambiguous !== true
  })
}

/** Mélange les propositions pour que la place de la bonne réponse ne dépende pas des habitudes du modèle. */
export function shuffleChoices<T extends { choices: string[]; answerIndex: number }>(q: T): T {
  const idx = [0, 1, 2, 3]
  for (let i = 3; i > 0; i--) { const j = randomInt(i + 1); [idx[i], idx[j]] = [idx[j], idx[i]] }
  return { ...q, choices: idx.map((k) => q.choices[k]), answerIndex: idx.indexOf(q.answerIndex) }
}

// ---- orchestration -----------------------------------------------------------
const MISSION_CHARS = 60_000

/** Met à jour l'avancement. Sert aussi de signe de vie : un travail sans signe depuis longtemps est repris par la file. */
const touch = (id: string, data: Record<string, unknown>) => prisma.studyCourse.update({ where: { id }, data: { ...data, lockedAt: new Date() } })

/**
 * Traite un cours de la file : analyse du cours entier (structure), puis pour CHAQUE mission : création des questions sur son seul texte,
 * contrôles du code, relecture indépendante. Lance une StudyError (retryable ou non) en cas d'échec : la file décide de réessayer.
 */
export async function processCourse(courseId: string) {
  const course = await prisma.studyCourse.findUnique({ where: { id: courseId } })
  const pages = Array.isArray(course?.sourceText) ? (course!.sourceText as string[]) : null
  if (!course || !pages?.length) throw new StudyError('Le cours n’est plus disponible. Importez-le à nouveau.')
  const unit: 'page' | 'section' = course.unit === 'page' ? 'page' : 'section'

  await touch(courseId, { status: 'ANALYSING', model: config.geminiModel, progress: 5, step: 'Lecture du cours' })
  const a = analysisSchema.safeParse(await generateJson({ system: SYSTEM_ANALYSE, user: userAnalyse(pages, unit), schema: ANALYSE_SCHEMA, temperature: 0.2 }))
  if (!a.success) throw new StudyError('L’analyse du cours n’a pas abouti. Réessayez avec un autre document.')
  if (!a.data.usable || a.data.missions.length === 0) {
    throw new StudyError(a.data.unusableReason?.trim() || 'Ce document ne ressemble pas à un support de cours exploitable.')
  }
  // Au plus 4 notions par mission (trois questions chacune) ; sans notion repérée, la mission est sa propre notion.
  const missions = normalizeMissions(a.data.missions, pages.length).map((m) => ({
    ...m, notions: m.notions.length ? m.notions.slice(0, 4) : [{ label: m.title, page: m.startPage, excerpt: '' }],
  }))
  const analysis: Analysis = { ...a.data, missions, unit }
  await touch(courseId, { status: 'CREATING', title: analysis.title, analysis: analysis as object, progress: 20, step: 'Création des questions' })

  const seen = new Set<string>()
  const accepted: { missionIndex: number; q: ValidQuestion }[] = []

  for (let mi = 0; mi < missions.length; mi++) {
    const m = missions[mi]
    // Texte de la mission seulement (plafonné), pages gardant leur numéro d'origine.
    const part: { n: number; text: string }[] = []
    let chars = 0
    for (let p = m.startPage; p <= m.endPage; p++) {
      if (chars + pages[p - 1].length > MISSION_CHARS && part.length) break
      part.push({ n: p, text: pages[p - 1] }); chars += pages[p - 1].length
    }
    const texts = part.map((p) => p.text)
    const out: any = await generateJson({
      system: SYSTEM_CREATE,
      user: userCreateMission({ title: m.title, pages: part, unit, notions: m.notions.map((n) => n.label), avoid: accepted.map((x) => x.q.question) }),
      schema: CREATE_SCHEMA, temperature: 0.4,
    })
    const { kept } = validateQuestions(Array.isArray(out?.questions) ? out.questions : [], texts, part[0].n, m.notions.length, seen)
    let good: ValidQuestion[] = []
    if (kept.length) {
      await touch(courseId, { progress: 20 + Math.round(((mi + 0.5) / missions.length) * 70), step: `Relecture · mission ${mi + 1}/${missions.length}` })
      const v: any = await generateJson({
        system: SYSTEM_VERIFY, user: userVerify({ pages: part, unit, questions: kept.map((q) => ({ question: q.question, choices: q.choices })) }),
        schema: VERIFY_SCHEMA, temperature: 0,
      })
      if (!Array.isArray(v?.results) || !v.results.length) throw new StudyError('La relecture des questions n’a pas abouti. Nouvel essai bientôt.', true)
      good = applyVerdicts(kept, v.results)
    }
    good.forEach((q) => accepted.push({ missionIndex: mi, q }))
    await touch(courseId, { progress: 20 + Math.round(((mi + 1) / missions.length) * 70), step: `Mission ${mi + 1}/${missions.length} prête` })
  }

  if (accepted.length < 3) throw new StudyError('Le cours ne contient pas assez de matière vérifiable pour créer un parcours. Essayez un document plus complet.')

  // Ordre de jeu : crescendo dans chaque mission (tous les niveaux 1, puis les 2, puis les 3), notion après notion.
  accepted.sort((x, y) => x.missionIndex - y.missionIndex || x.q.level - y.q.level || x.q.notionIndex - y.q.notionIndex)
  const KINDS = ['rappel', 'comprehension', 'application']
  const notionRows: { id: string; courseId: string; missionId: string; position: number; label: string; sourcePage: number | null }[] = []
  const notionId = new Map<string, string>()
  for (const { missionIndex, q } of accepted) {
    const key = `${missionIndex}:${q.notionIndex}`
    if (notionId.has(key)) continue
    const n = missions[missionIndex].notions[q.notionIndex]
    const id = randomUUID()
    notionId.set(key, id)
    notionRows.push({ id, courseId, missionId: `m${missionIndex + 1}`, position: q.notionIndex, label: n.label.slice(0, 160), sourcePage: n.page ?? null })
  }

  await prisma.$transaction([
    prisma.studyQuestion.deleteMany({ where: { courseId } }),
    prisma.studyNotion.deleteMany({ where: { courseId } }),
    prisma.studyNotionState.deleteMany({ where: { courseId } }),      // les anciens rappels visaient d'anciennes notions
    prisma.studyNotion.createMany({ data: notionRows }),
    prisma.studyQuestion.createMany({
      data: accepted.map(({ missionIndex, q }, i) => {
        const s = shuffleChoices(q)
        return {
          courseId, missionId: `m${missionIndex + 1}`, notionId: notionId.get(`${missionIndex}:${q.notionIndex}`), level: s.level, position: i,
          kind: KINDS[s.level - 1], text: s.question, choices: s.choices,
          answerIndex: s.answerIndex, explanation: s.explanation, sourcePage: s.sourcePage, sourceExcerpt: s.sourceExcerpt, verified: true,
        }
      }),
    }),
    // Le texte du cours est effacé dès que le parcours est prêt : seules l'analyse et les questions restent.
    prisma.studyCourse.update({ where: { id: courseId }, data: { status: 'READY', error: null, sourceText: Prisma.DbNull, progress: 100, step: null, lockedAt: null } }),
  ])
}
