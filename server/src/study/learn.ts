// Learn Engine de Study : état pédagogique de chaque NOTION et rappels espacés, séparés de l'XP de jeu.
// Règles du Pitch Board : « Consolidée » = au moins 3 réussites non assistées sur des questions distinctes, en 2 séances à 24 h d'écart.
// Rappels : J+1 après une erreur, puis J+3, J+7, J+14 après réussite. Une notion est révisée avec une question différente à chaque fois.
// Les anciens cours (sans notions) sont suivis par mission : chaque mission y joue le rôle d'une notion.
import { prisma } from '../db.js'
import { StudyError } from './gemini.js'

export const DAY = 86_400_000
export const XP_PER_LEVEL = 300
const REVIEW_DAYS = [3, 7, 14]           // intervalle après la 1re, 2e, 3e réussite de suite (et au-delà)
const OVERDUE_MS = 7 * DAY               // rappel en retard de plus d'une semaine : la notion est à réactiver

export type NotionState = 'a_decouvrir' | 'en_cours' | 'a_consolider' | 'consolidee' | 'a_reactiver'

/** Une partie ne dépasse pas 12 questions : au-delà, on en garde 12 réparties régulièrement (l'ordre, donc le crescendo, est conservé). */
export const RUN_CAP = 12
export function sampleRun<T>(qs: T[], cap = RUN_CAP): T[] {
  if (qs.length <= cap) return qs
  return Array.from({ length: cap }, (_, k) => qs[Math.round((k * (qs.length - 1)) / (cap - 1))])
}

export const levelOf = (xp: number) => 1 + Math.floor(xp / XP_PER_LEVEL)

/** Prochain rappel d'une notion après une séance. */
export function nextReview(correct: boolean, box: number, now: Date): { box: number; dueAt: Date } {
  if (!correct) return { box: 0, dueAt: new Date(now.getTime() + DAY) }
  const b = Math.min(box + 1, REVIEW_DAYS.length)
  return { box: b, dueAt: new Date(now.getTime() + REVIEW_DAYS[b - 1] * DAY) }
}

export const starsFor = (ratio: number): 0 | 1 | 2 | 3 => (ratio >= 0.9 ? 3 : ratio >= 0.6 ? 2 : ratio >= 0.34 ? 1 : 0)

/** XP de réponses : 100 par bonne réponse, +25 par bonne réponse de suite (jusqu'à +100), comme dans le jeu. */
export function scoreAnswers(flags: boolean[]) {
  let streak = 0, best = 0, xp = 0, correct = 0
  for (const ok of flags) {
    if (ok) { streak++; best = Math.max(best, streak); correct++; xp += 100 + 25 * Math.min(streak - 1, 4) } else streak = 0
  }
  return { xp, bestStreak: best, correct }
}

/** Clé de suivi d'une question : sa notion, ou sa mission pour les anciens cours. */
export const notionKeyOf = (q: { notionId: string | null; missionId: string }) => q.notionId ?? `m:${q.missionId}`

export interface Attempt { correct: boolean; unassisted: boolean; sessionId: string; at: Date }
/** `questions` : l'historique de chaque question de la notion. `last` : planning courant de la notion (null = jamais jouée). */
export function notionState(questions: Attempt[][], last: { lastCorrect: boolean; dueAt: Date } | null, now: Date): NotionState {
  if (questions.every((q) => q.length === 0)) return 'a_decouvrir'
  const need = Math.min(3, questions.length)
  const wins = questions.flatMap((q) => q.filter((a) => a.correct && a.unassisted))
  const distinct = questions.filter((q) => q.some((a) => a.correct && a.unassisted)).length
  const times = wins.map((w) => w.at.getTime())
  const sessions = new Set(wins.map((w) => w.sessionId))
  const criteria = distinct >= need && sessions.size >= 2 && times.length > 0 && Math.max(...times) - Math.min(...times) >= DAY
  if (criteria) {
    const stale = !!last && (!last.lastCorrect || now.getTime() - last.dueAt.getTime() > OVERDUE_MS)
    return stale ? 'a_reactiver' : 'consolidee'
  }
  return distinct >= need ? 'a_consolider' : 'en_cours'
}

/** État d'une mission déduit de celui de ses notions. */
export function missionStateOf(states: NotionState[]): NotionState {
  if (states.every((s) => s === 'a_decouvrir')) return 'a_decouvrir'
  if (states.includes('a_reactiver')) return 'a_reactiver'
  if (states.every((s) => s === 'consolidee')) return 'consolidee'
  if (states.every((s) => s !== 'a_decouvrir' && s !== 'en_cours')) return 'a_consolider'
  return 'en_cours'
}

/** Numéro d'une mission (« m3 » → 3). */
export const missionNo = (id: string) => Number(id.slice(1))

interface Q { id: string; notionId: string | null; missionId: string; level: number; position: number }
interface LatestAttempt { questionId: string; correct: boolean; at: Date }

/**
 * Choisit les questions d'une révision : une par notion à réviser, différente de la précédente quand c'est possible.
 * Priorité aux notions ratées, puis aux plus en retard ; jouées du plus facile au plus difficile.
 */
export function pickReview<T extends Q>(questions: T[], due: { notionKey: string; lastCorrect: boolean; dueAt: Date }[], attempts: LatestAttempt[], limit = 8): T[] {
  const latest = new Map<string, LatestAttempt>()                       // dernière réponse par question
  for (const a of attempts) { const cur = latest.get(a.questionId); if (!cur || a.at > cur.at) latest.set(a.questionId, a) }
  const picked: T[] = []
  const order = [...due].sort((a, b) => Number(a.lastCorrect) - Number(b.lastCorrect) || a.dueAt.getTime() - b.dueAt.getTime())
  for (const d of order) {
    const group = questions.filter((q) => notionKeyOf(q) === d.notionKey)
    if (!group.length) continue
    // La dernière question posée pour cette notion : on évite de la reposer tout de suite.
    const lastAsked = group.map((q) => latest.get(q.id)).filter((x): x is LatestAttempt => !!x).sort((a, b) => b.at.getTime() - a.at.getTime())[0]?.questionId
    const pool = group.length > 1 ? group.filter((q) => q.id !== lastAsked) : group
    const rank = (q: T) => { const l = latest.get(q.id); return l ? (l.correct ? 2 : 0) : 1 }
    pool.sort((a, b) => rank(a) - rank(b) || (latest.get(a.id)?.at.getTime() ?? 0) - (latest.get(b.id)?.at.getTime() ?? 0) || a.level - b.level)
    picked.push(pool[0])
    if (picked.length >= limit) break
  }
  return picked.sort((a, b) => a.level - b.level || a.position - b.position)
}

/** Notions à réviser maintenant pour un cours. */
export async function reviewQuestions(studentId: string, courseId: string, limit = 8, maxMissions = Infinity) {
  const course = await prisma.studyCourse.findFirst({ where: { id: courseId, studentId }, include: { questions: { orderBy: { position: 'asc' } } } })
  if (!course) return []
  course.questions = course.questions.filter((q) => missionNo(q.missionId) <= maxMissions)
  const now = new Date()
  const [due, attempts] = await Promise.all([
    prisma.studyNotionState.findMany({ where: { studentId, courseId, dueAt: { lte: now } }, select: { notionKey: true, lastCorrect: true, dueAt: true } }),
    prisma.studyAttempt.findMany({ where: { studentId, questionId: { in: course.questions.map((q) => q.id) } }, select: { questionId: true, correct: true, createdAt: true } }),
  ])
  return pickReview(course.questions, due, attempts.map((a) => ({ questionId: a.questionId, correct: a.correct, at: a.createdAt })), limit)
}

// ---- enregistrement d'une partie ------------------------------------------------------------------------
export interface SessionInput { scope: string; answers: { questionId: string; chosen: number }[]; coins?: number; finished?: boolean }

export async function recordSession(studentId: string, courseId: string, input: SessionInput, maxMissions = Infinity) {
  const course = await prisma.studyCourse.findFirst({ where: { id: courseId, studentId, status: 'READY' }, include: { questions: true } })
  if (!course) throw new StudyError('Cours introuvable.')
  course.questions = course.questions.filter((q) => missionNo(q.missionId) <= maxMissions) // plan Découverte : seules les premières missions comptent
  const byId = new Map(course.questions.map((q) => [q.id, q]))
  const { scope, answers } = input
  const m = /^mission:(m\d+)$/.exec(scope)
  if (scope !== 'course' && scope !== 'review' && !m) throw new StudyError('Partie invalide.')
  if (!answers.length || answers.length > course.questions.length) throw new StudyError('Partie invalide.')
  if (new Set(answers.map((a) => a.questionId)).size !== answers.length) throw new StudyError('Partie invalide.')
  for (const a of answers) {
    const q = byId.get(a.questionId)
    if (!q || !Number.isInteger(a.chosen) || a.chosen < 0 || a.chosen > 3 || (m && q.missionId !== m[1])) throw new StudyError('Partie invalide.')
  }

  const flags = answers.map((a) => a.chosen === byId.get(a.questionId)!.answerIndex)
  const { xp, bestStreak, correct } = scoreAnswers(flags)
  const wrong = flags.length - correct
  const expected = scope === 'course' ? Math.min(RUN_CAP, course.questions.length) : m ? Math.min(RUN_CAP, course.questions.filter((q) => q.missionId === m[1]).length) : answers.length
  const victory = wrong < 3 && answers.length === expected && (scope !== 'review' || input.finished === true)
  const stars = victory ? starsFor(correct / expected) : 0
  const coins = Math.min(Math.max(Math.trunc(input.coins ?? 0), 0), 60)
  const now = new Date()

  // Missions entièrement répondues pendant cette partie : leurs étoiles alimentent la carte.
  const doneMissions = new Map<string, boolean[]>()
  answers.forEach((a, i) => { const k = byId.get(a.questionId)!.missionId; doneMissions.set(k, [...(doneMissions.get(k) ?? []), flags[i]]) })
  const missionStars: { id: string; stars: number }[] = []
  for (const [id, fl] of doneMissions) {
    const total = course.questions.filter((q) => q.missionId === id).length
    if (fl.length === total) missionStars.push({ id, stars: starsFor(fl.filter(Boolean).length / total) })
  }

  // Une notion est replanifiée une seule fois par séance : réussie si toutes ses questions jouées sont justes.
  const perNotion = new Map<string, boolean[]>()
  answers.forEach((a, i) => { const k = notionKeyOf(byId.get(a.questionId)!); perNotion.set(k, [...(perNotion.get(k) ?? []), flags[i]]) })
  const prev = await prisma.studyNotionState.findMany({ where: { studentId, notionKey: { in: [...perNotion.keys()] } } })
  const prevBy = new Map(prev.map((p) => [p.notionKey, p]))

  const newlyOpen: string[] = []
  const session = await prisma.$transaction(async (tx) => {
    const s = await tx.studySession.create({ data: { studentId, courseId, scope, xp, stars, correct, total: expected, bestStreak, coins, victory } })
    await tx.studyAttempt.createMany({ data: answers.map((a, i) => ({ sessionId: s.id, studentId, questionId: a.questionId, correct: flags[i], createdAt: new Date(now.getTime() + i) })) })   // décalage d'1 ms : l'ordre des réponses est conservé
    for (const [key, fl] of perNotion) {
      const ok = fl.every(Boolean)
      const nx = nextReview(ok, prevBy.get(key)?.box ?? 0, now)
      await tx.studyNotionState.upsert({
        where: { studentId_notionKey: { studentId, notionKey: key } },
        create: { studentId, courseId, notionKey: key, box: nx.box, dueAt: nx.dueAt, lastCorrect: ok, attempts: 1 },
        update: { box: nx.box, dueAt: nx.dueAt, lastCorrect: ok, attempts: { increment: 1 } },
      })
    }
    for (const ms of missionStars) {
      const cur = await tx.studyMissionResult.findUnique({ where: { studentId_courseId_missionId: { studentId, courseId, missionId: ms.id } } })
      if ((cur?.bestStars ?? 0) === 0 && ms.stars > 0) newlyOpen.push(ms.id)
      await tx.studyMissionResult.upsert({
        where: { studentId_courseId_missionId: { studentId, courseId, missionId: ms.id } },
        create: { studentId, courseId, missionId: ms.id, bestStars: ms.stars, plays: 1 },
        update: { bestStars: Math.max(cur?.bestStars ?? 0, ms.stars), plays: { increment: 1 } },
      })
    }
    return s
  })
  // Mission qui vient de s'ouvrir (la suivante dans le cours) et mission suivante pour le bouton « Mission suivante ».
  const order = [...new Set(course.questions.map((q) => q.missionId))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  const after = (id: string) => order[order.indexOf(id) + 1] ?? null
  const unlocked = newlyOpen.map(after).filter((x): x is string => !!x)
  const nextMissionId = m && stars > 0 ? after(m[1]) : null
  const totalXp = (await prisma.studySession.aggregate({ where: { studentId }, _sum: { xp: true } }))._sum.xp ?? 0
  return { sessionId: session.id, xp, stars, correct, total: expected, victory, bestStreak, totalXp, level: levelOf(totalXp), missions: missionStars, unlocked, nextMissionId }
}

// ---- lecture : carte d'un cours et profil ---------------------------------------------------------------
export async function courseProgress(studentId: string, courseId: string, maxMissions = Infinity) {
  const course = await prisma.studyCourse.findFirst({ where: { id: courseId, studentId }, include: { questions: { orderBy: { position: 'asc' } }, notions: { orderBy: { position: 'asc' } } } })
  if (!course) throw new StudyError('Cours introuvable.')
  const now = new Date()
  const ids = course.questions.map((q) => q.id)
  const [attempts, states, results] = await Promise.all([
    prisma.studyAttempt.findMany({ where: { studentId, questionId: { in: ids } }, select: { questionId: true, correct: true, unassisted: true, sessionId: true, createdAt: true } }),
    prisma.studyNotionState.findMany({ where: { studentId, courseId } }),
    prisma.studyMissionResult.findMany({ where: { studentId, courseId } }),
  ])
  const analysis = course.analysis as { missions?: { title: string }[] } | null
  const missionIds = [...new Set(course.questions.map((q) => q.missionId))].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
  let prevStars = 1                                      // la première mission est toujours ouverte
  const missions = missionIds.map((id) => {
    const idx = Number(id.slice(1)) - 1
    const title = analysis?.missions?.[idx]?.title ?? `Mission ${idx + 1}`
    const qs = course.questions.filter((q) => q.missionId === id)
    // Notions de la mission (une pseudo-notion pour les anciens cours sans notions).
    const keys = [...new Set(qs.map(notionKeyOf))]
    const notions = keys.map((key) => {
      const group = qs.filter((q) => notionKeyOf(q) === key)
      const st = states.find((s) => s.notionKey === key) ?? null
      const hist = group.map((q) => attempts.filter((a) => a.questionId === q.id).map((a) => ({ correct: a.correct, unassisted: a.unassisted, sessionId: a.sessionId, at: a.createdAt })))
      return {
        id: key, label: course.notions.find((n) => n.id === key)?.label ?? title, questions: group.length,
        state: notionState(hist, st ? { lastCorrect: st.lastCorrect, dueAt: st.dueAt } : null, now),
        due: !!st && st.dueAt <= now, lastCorrect: st ? st.lastCorrect : null,
      }
    })
    const r = results.find((x) => x.missionId === id)
    const out = {
      id, title, questions: qs.length, notions, state: missionStateOf(notions.map((n) => n.state)),
      stars: r?.bestStars ?? 0, plays: r?.plays ?? 0, locked: prevStars < 1 || idx + 1 > maxMissions, planLocked: idx + 1 > maxMissions, due: notions.filter((n) => n.due && idx + 1 <= maxMissions).length,
    }
    prevStars = out.stars
    return out
  })
  const all = missions.flatMap((m) => m.notions)
  return { missions, due: missions.reduce((n, m) => n + m.due, 0), notions: all.length, mastered: all.filter((n) => n.state === 'consolidee').length }
}

const utcDay = (d: Date) => Math.floor(d.getTime() / DAY)

export async function studentStats(studentId: string) {
  const now = new Date()
  const sessions = await prisma.studySession.findMany({ where: { studentId }, select: { xp: true, stars: true, scope: true, total: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
  const totalXp = sessions.reduce((n, s) => n + s.xp, 0)
  // Série de jours : jours consécutifs avec au moins une partie, en comptant aujourd'hui ou hier.
  const days = new Set(sessions.map((s) => utcDay(s.createdAt)))
  let streak = 0
  for (let d = utcDay(now) - (days.has(utcDay(now)) ? 0 : 1); days.has(d); d--) streak++
  const today = sessions.filter((s) => utcDay(s.createdAt) === utcDay(now))
  const dueRows = await prisma.studyNotionState.findMany({ where: { studentId, dueAt: { lte: now }, course: { status: 'READY' } }, select: { courseId: true, course: { select: { title: true, fileName: true } } } })
  const dueBy = new Map<string, { courseId: string; title: string; due: number }>()
  for (const r of dueRows) {
    const c = dueBy.get(r.courseId) ?? { courseId: r.courseId, title: r.course.title ?? r.course.fileName, due: 0 }
    c.due++; dueBy.set(r.courseId, c)
  }
  const reviewed = today.filter((s) => s.scope === 'review').reduce((n, s) => n + s.total, 0)
  return {
    totalXp, level: levelOf(totalXp), levelXp: totalXp % XP_PER_LEVEL, levelSize: XP_PER_LEVEL, streakDays: streak, sessions: sessions.length,
    due: dueRows.length, dueCourses: [...dueBy.values()],        // « due » = notions à réviser
    quests: [
      { key: 'play', label: 'Jouer une partie', goal: 1, value: Math.min(today.length, 1) },
      { key: 'stars', label: 'Décrocher 2 étoiles', goal: 1, value: today.some((s) => s.stars >= 2) ? 1 : 0 },
      { key: 'review', label: 'Réviser 3 questions', goal: 3, value: Math.min(reviewed, 3) },
    ],
  }
}

/** Écran « Mon évolution » : maîtrise globale, notions à retravailler, régularité sur 7 jours. Volontairement court. */
export async function evolution(studentId: string) {
  const now = new Date()
  const courses = await prisma.studyCourse.findMany({ where: { studentId, status: 'READY' }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, fileName: true } })
  const rows: { id: string; title: string; notions: number; mastered: number; pct: number }[] = []
  const weak: { courseId: string; course: string; label: string; state: NotionState }[] = []
  for (const c of courses) {
    const p = await courseProgress(studentId, c.id)
    const title = c.title ?? c.fileName
    rows.push({ id: c.id, title, notions: p.notions, mastered: p.mastered, pct: p.notions ? Math.round((p.mastered / p.notions) * 100) : 0 })
    for (const m of p.missions) for (const n of m.notions) {
      if (n.state === 'a_reactiver' || (n.lastCorrect === false && n.state !== 'a_decouvrir')) weak.push({ courseId: c.id, course: title, label: n.label, state: n.state })
    }
  }
  weak.sort((a, b) => Number(b.state === 'a_reactiver') - Number(a.state === 'a_reactiver'))
  const since = new Date(now.getTime() - 7 * DAY)
  const sessions = await prisma.studySession.findMany({ where: { studentId, createdAt: { gte: since } }, select: { createdAt: true } })
  const played = new Set(sessions.map((s) => utcDay(s.createdAt)))
  const week = Array.from({ length: 7 }, (_, k) => {
    const d = utcDay(now) - (6 - k)
    return { day: new Date(d * DAY).toISOString().slice(0, 10), played: played.has(d) }
  })
  const notions = rows.reduce((n, r) => n + r.notions, 0)
  const mastered = rows.reduce((n, r) => n + r.mastered, 0)
  const stats = await studentStats(studentId)
  return { notions, mastered, pct: notions ? Math.round((mastered / notions) * 100) : 0, courses: rows, weak: weak.slice(0, 4), week, streakDays: stats.streakDays, due: stats.due, dueCourseId: stats.dueCourses[0]?.courseId ?? null }
}
