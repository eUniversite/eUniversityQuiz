import { Prisma } from '@prisma/client'
import { prisma } from './db.js'
import { pointsFor, rankBy } from './scoring.js'
import { hashToken, newSessionCode, newToken, normalizeNickname } from './security.js'

export class EngineError extends Error {
  constructor(public code: string, message: string, public http = 400) { super(message) }
}

type SStatus = 'WAITING' | 'READY' | 'OPEN' | 'CORRECTION' | 'ENDED'
interface QRow {
  id: string; position: number; text: string; options: string[]; correctIndex: number | null
  durationSec: number; explanation: string | null
  status: 'PENDING' | 'OPEN' | 'CLOSED'; openedAt: number | null; deadlineAt: number | null
}
interface PRow { id: string; fullName: string; nickname: string; nicknameKey: string; totalScore: number; claimable: boolean }
interface AnswerRow { choiceIndex: number; points: number; correct: boolean }
interface Live {
  id: string; code: string; teacherId: string; quizTitle: string
  status: SStatus; currentIndex: number; questions: QRow[]
  participants: Map<string, PRow>
  answers: Map<string, AnswerRow> // réponses de la question courante
  connected: Map<string, number>
  inflight: Set<Promise<unknown>>
  closing?: boolean
  timer?: NodeJS.Timeout
  countsTimer?: NodeJS.Timeout
  lock: Promise<unknown>
  ranks?: { byId: Map<string, number>; list: { rank: number; p: PRow }[] }
  correctCounts?: Map<string, number>
}

export interface Hub {
  broadcastState(live: { id: string }): void
  sendMe(sessionId: string, participantId: string): void
  broadcastCounts(sessionId: string, counts: Counts): void
  kick(participantId: string): void
}
export interface Counts { registered: number; connected: number; answered: number }

const shortName = (p: PRow) => p.nickname
const tidy = (s: string) => s.trim().replace(/\s+/g, ' ')
const titleCase = (s: string) => (s === s.toLowerCase() || s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'’-])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()) : s)
const fold = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()

class Engine {
  hub: Hub = { broadcastState() {}, sendMe() {}, broadcastCounts() {}, kick() {} }
  private lives = new Map<string, Live>()
  private byCode = new Map<string, string>()
  private tokens = new Map<string, { sessionId: string; participantId: string }>()
  private sweeper?: NodeJS.Timeout

  // ---------- chargement / cycle de vie ----------
  async start() {
    const open = await prisma.sessionQuestion.findMany({ where: { status: 'OPEN' }, select: { sessionId: true } })
    for (const sid of new Set(open.map((o) => o.sessionId))) await this.getLive(sid)
    this.sweeper = setInterval(() => this.sweep(), 2000)
    this.sweeper.unref()
  }
  stop() {
    if (this.sweeper) clearInterval(this.sweeper)
    for (const l of this.lives.values()) { clearTimeout(l.timer); clearTimeout(l.countsTimer) }
    this.lives.clear(); this.byCode.clear(); this.tokens.clear(); this.loading.clear()
  }

  /** Vide la mémoire des sessions en cours (après une purge de la base) : minuteries arrêtées, plus aucune session fantôme. */
  resetCache() {
    for (const l of this.lives.values()) { clearTimeout(l.timer); clearTimeout(l.countsTimer) }
    this.lives.clear(); this.byCode.clear(); this.tokens.clear(); this.loading.clear()
  }

  private sweep() {
    const now = Date.now()
    for (const l of this.lives.values()) {
      const q = this.cur(l)
      if (l.status === 'OPEN' && q && q.deadlineAt && now >= q.deadlineAt) void this.closeQuestion(l).catch(() => {})
    }
  }

  /** Une session ne se charge à froid qu'une fois : sans single-flight, des reconnexions simultanées créeraient des instances Live orphelines. */
  private loading = new Map<string, Promise<Live | null>>()

  async getLive(idOrCode: string): Promise<Live | null> {
    const key = this.byCode.get(idOrCode) ?? idOrCode
    const hit = this.lives.get(key) ?? this.lives.get(idOrCode)
    if (hit) return hit
    let p = this.loading.get(key)
    if (!p) {
      p = this.loadLive(idOrCode)
      this.loading.set(key, p)
      void p.finally(() => this.loading.delete(key))
    }
    const l = await p
    // Une charge concurrente via l'autre clé (code vs id) a pu gagner : ne retourner que l'instance en cache.
    return l ? this.lives.get(l.id) ?? l : null
  }

  private async loadLive(idOrCode: string): Promise<Live | null> {
    const s = await prisma.session.findFirst({
      where: { OR: [{ id: idOrCode }, { code: idOrCode }] },
      include: { questions: { orderBy: { position: 'asc' } }, participants: true },
    }).catch(() => null)
    if (!s) return null
    const again = this.lives.get(s.id)
    if (again) return again
    const live: Live = {
      id: s.id, code: s.code, teacherId: s.teacherId, quizTitle: s.quizTitle,
      status: s.status as SStatus, currentIndex: s.currentIndex,
      questions: s.questions.map((q) => ({
        id: q.id, position: q.position, text: q.text, options: q.options as string[], correctIndex: q.correctIndex,
        durationSec: q.durationSec, explanation: q.explanation, status: q.status,
        openedAt: q.openedAt?.getTime() ?? null, deadlineAt: q.deadlineAt?.getTime() ?? null,
      })),
      participants: new Map(s.participants.map((p) => [p.id, {
        id: p.id, fullName: p.fullName, nickname: p.nickname, nicknameKey: p.nicknameKey,
        totalScore: p.totalScore, claimable: p.claimable,
      }])),
      answers: new Map(), connected: new Map(), inflight: new Set(), lock: Promise.resolve(),
    }
    const q = this.cur(live)
    if (q && live.status !== 'READY') {
      const rows = await prisma.answer.findMany({ where: { questionId: q.id } })
      for (const a of rows) live.answers.set(a.participantId, { choiceIndex: a.choiceIndex, points: a.points, correct: a.correct })
    }
    if (live.status === 'ENDED') await this.loadCorrectCounts(live)
    this.lives.set(live.id, live)
    this.byCode.set(live.code, live.id)
    if (live.status === 'OPEN' && q?.deadlineAt) this.schedule(live, q)
    return live
  }

  private cur(l: Live) { return l.questions[l.currentIndex] as QRow | undefined }

  private schedule(l: Live, q: QRow) {
    clearTimeout(l.timer)
    l.timer = setTimeout(() => void this.closeQuestion(l).catch((e) => console.error('close error', e)), Math.max(0, q.deadlineAt! - Date.now()))
  }

  private withLock<T>(l: Live, fn: () => Promise<T>): Promise<T> {
    const run = l.lock.then(fn, fn)
    l.lock = run.catch(() => {})
    return run
  }

  private async loadCorrectCounts(l: Live) {
    const rows = await prisma.answer.groupBy({ by: ['participantId'], where: { correct: true, question: { sessionId: l.id } }, _count: { _all: true } })
    l.correctCounts = new Map(rows.map((r) => [r.participantId, r._count._all]))
  }

  // ---------- classement ----------
  private ranking(l: Live) {
    if (!l.ranks) {
      const list = rankBy([...l.participants.values()], (p) => p.totalScore).map(({ rank, item }) => ({ rank, p: item }))
      l.ranks = { byId: new Map(list.map((e) => [e.p.id, e.rank])), list }
    }
    return l.ranks
  }

  // ---------- vues ----------
  counts(l: Live): Counts {
    return { registered: l.participants.size, connected: l.connected.size, answered: l.answers.size }
  }

  state(l: Live, view: 'audience' | 'teacher') {
    const q = this.cur(l)
    const showQ = q && (l.status === 'OPEN' || l.status === 'CORRECTION' || (view === 'teacher' && l.status === 'READY'))
    const s: Record<string, unknown> = {
      code: l.code, status: l.status, quizTitle: l.quizTitle, serverNow: Date.now(),
      totalQuestions: l.questions.length, currentIndex: l.currentIndex, ...this.counts(l),
      question: showQ ? {
        id: q.id, index: q.position, text: q.text, options: q.options, durationSec: q.durationSec,
        openedAt: q.openedAt, deadlineAt: q.deadlineAt,
      } : null,
      nextDurationSec: l.status === 'READY' && q ? q.durationSec : null,
    }
    if (l.status === 'CORRECTION' && q) {
      s.correction = {
        correctIndex: q.correctIndex, poll: q.correctIndex === null, explanation: q.explanation,
        distribution: q.options.map((_, i) => [...l.answers.values()].filter((a) => a.choiceIndex === i).length),
      }
      s.top5 = this.ranking(l).list.filter((e) => e.rank <= 5).slice(0, 8).map((e) => ({ rank: e.rank, name: shortName(e.p), score: e.p.totalScore }))
      s.isLast = l.currentIndex >= l.questions.length - 1
    }
    if (l.status === 'ENDED') {
      s.podium = this.ranking(l).list.filter((e) => e.rank <= 3).slice(0, 10).map((e) => ({ rank: e.rank, name: shortName(e.p), score: e.p.totalScore }))
      s.top10 = this.ranking(l).list.slice(0, 10).map((e) => ({ rank: e.rank, name: shortName(e.p), score: e.p.totalScore }))
    }
    if (view === 'teacher') {
      s.participants = [...l.participants.values()].map((p) => ({
        id: p.id, fullName: p.fullName, nickname: p.nickname, score: p.totalScore,
        connected: l.connected.has(p.id), answered: l.status === 'OPEN' || l.status === 'CORRECTION' ? l.answers.has(p.id) : false,
        claimable: p.claimable,
      }))
    }
    return s
  }

  me(l: Live, pid: string) {
    const p = l.participants.get(pid)
    if (!p) return null
    const q = this.cur(l)
    const a = l.answers.get(pid)
    const m: Record<string, unknown> = {
      nickname: p.nickname, fullName: p.fullName, total: p.totalScore, rank: this.ranking(l).byId.get(pid) ?? null,
      participants: l.participants.size,
      answered: (l.status === 'OPEN' || l.status === 'CORRECTION') && a ? { questionId: q!.id, choiceIndex: a.choiceIndex } : null,
    }
    if (l.status === 'CORRECTION' && q) m.result = { questionId: q.id, choiceIndex: a?.choiceIndex ?? null, correct: !!a?.correct, points: a?.points ?? 0, poll: q.correctIndex === null }
    if (l.status === 'ENDED') m.final = { correctCount: l.correctCounts?.get(pid) ?? 0, questions: l.questions.length }
    return m
  }

  async stateByCode(code: string, view: 'audience' | 'teacher') {
    const l = await this.getLive(code)
    return l ? this.state(l, view) : null
  }

  // ---------- présence ----------
  attach(l: Live, pid: string) {
    l.connected.set(pid, (l.connected.get(pid) ?? 0) + 1)
    this.touchCounts(l)
  }
  detach(l: Live, pid: string) {
    const n = (l.connected.get(pid) ?? 1) - 1
    if (n <= 0) l.connected.delete(pid); else l.connected.set(pid, n)
    this.touchCounts(l)
  }
  touchCounts(l: Live) {
    if (l.countsTimer) return
    l.countsTimer = setTimeout(() => { l.countsTimer = undefined; this.hub.broadcastCounts(l.id, this.counts(l)) }, 700)
    l.countsTimer.unref()
  }

  // ---------- professeur ----------
  async createSession(teacherId: string, quizId: string) {
    const quiz = await prisma.quiz.findFirst({ where: { id: quizId, teacherId }, include: { questions: { orderBy: { position: 'asc' } } } })
    if (!quiz) throw new EngineError('NOT_FOUND', 'Quiz introuvable.', 404)
    if (!quiz.questions.length) throw new EngineError('EMPTY_QUIZ', 'Ce quiz ne contient aucune question.')
    for (let i = 0; i < 5; i++) {
      try {
        const s = await prisma.session.create({
          data: {
            code: newSessionCode(), teacherId, quizId, quizTitle: quiz.title,
            questions: { create: quiz.questions.map((q, idx) => ({ position: idx, text: q.text, options: q.options as Prisma.InputJsonValue, correctIndex: q.correctIndex, durationSec: q.durationSec, explanation: q.explanation })) },
          },
        })
        return s
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e
      }
    }
    throw new EngineError('CODE', 'Impossible de générer un code, réessayez.', 500)
  }

  private async ownedLive(sessionId: string, teacherId: string) {
    const l = await this.getLive(sessionId)
    if (!l || l.teacherId !== teacherId) throw new EngineError('FORBIDDEN', 'Session introuvable.', 404)
    return l
  }

  prepareNext(sessionId: string, teacherId: string) {
    return this.ownedLive(sessionId, teacherId).then((l) => this.withLock(l, async () => {
      if (l.status !== 'WAITING' && l.status !== 'CORRECTION') throw new EngineError('BAD_STATE', 'Impossible de préparer une question maintenant.')
      if (l.currentIndex + 1 >= l.questions.length) throw new EngineError('NO_MORE', 'Il n’y a plus de question. Terminez la session.')
      const idx = l.currentIndex + 1
      await prisma.session.update({ where: { id: l.id }, data: { status: 'READY', currentIndex: idx } })
      l.status = 'READY'; l.currentIndex = idx; l.answers.clear()
      this.hub.broadcastState(l)
    }))
  }

  openQuestion(sessionId: string, teacherId: string) {
    return this.ownedLive(sessionId, teacherId).then((l) => this.withLock(l, async () => {
      const q = this.cur(l)
      if (l.status !== 'READY' || !q) throw new EngineError('BAD_STATE', 'Aucune question prête à lancer.')
      const openedAt = Date.now()
      const deadlineAt = openedAt + q.durationSec * 1000
      await prisma.$transaction([
        prisma.sessionQuestion.update({ where: { id: q.id }, data: { status: 'OPEN', openedAt: new Date(openedAt), deadlineAt: new Date(deadlineAt) } }),
        prisma.session.update({ where: { id: l.id }, data: { status: 'OPEN' } }),
      ])
      q.status = 'OPEN'; q.openedAt = openedAt; q.deadlineAt = deadlineAt; l.status = 'OPEN'
      this.schedule(l, q)
      this.hub.broadcastState(l)
    }))
  }

  async endSession(sessionId: string, teacherId: string) {
    const l = await this.ownedLive(sessionId, teacherId)
    if (l.status === 'OPEN') await this.closeQuestion(l)
    await this.withLock(l, async () => {
      if (l.status === 'ENDED') return
      await prisma.session.update({ where: { id: l.id }, data: { status: 'ENDED', endedAt: new Date() } })
      l.status = 'ENDED'
      await this.loadCorrectCounts(l)
      this.hub.broadcastState(l)
      for (const pid of l.participants.keys()) this.hub.sendMe(l.id, pid)
    })
  }

  async resetParticipant(sessionId: string, teacherId: string, participantId: string) {
    const l = await this.ownedLive(sessionId, teacherId)
    const p = l.participants.get(participantId)
    if (!p) throw new EngineError('NOT_FOUND', 'Participant introuvable.', 404)
    const old = await prisma.participant.findUnique({ where: { id: participantId }, select: { tokenHash: true } })
    await prisma.participant.update({ where: { id: participantId }, data: { tokenHash: null, claimable: true } })
    if (old?.tokenHash) this.tokens.delete(old.tokenHash)
    p.claimable = true
    this.hub.kick(participantId)
    this.hub.broadcastState(l)
  }

  /** Ferme la question ouverte : une seule fois, points attribués dans la même transaction. */
  async closeQuestion(l: Live) {
    await this.withLock(l, async () => {
      const q = this.cur(l)
      if (!q || q.status !== 'OPEN') return
      clearTimeout(l.timer)
      l.closing = true
      await Promise.allSettled([...l.inflight])
      const changed = await prisma.$transaction(async (tx) => {
        const r = await tx.sessionQuestion.updateMany({ where: { id: q.id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } })
        if (r.count !== 1) return false
        await tx.session.update({ where: { id: l.id }, data: { status: 'CORRECTION' } })
        await tx.$executeRaw`UPDATE "Participant" p SET "totalScore" = p."totalScore" + a.points
          FROM "Answer" a WHERE a."questionId" = ${q.id} AND a."participantId" = p.id AND a.points > 0`
        return true
      }).catch((e) => { l.closing = false; throw e })
      if (!changed) { l.closing = false; return }
      const totals = await prisma.participant.findMany({ where: { sessionId: l.id }, select: { id: true, totalScore: true } })
      for (const t of totals) { const p = l.participants.get(t.id); if (p) p.totalScore = t.totalScore }
      q.status = 'CLOSED'; l.status = 'CORRECTION'; l.closing = false; l.ranks = undefined
      this.hub.broadcastState(l)
      for (const pid of l.participants.keys()) this.hub.sendMe(l.id, pid)
    })
  }

  // ---------- étudiants ----------
  async lookupCode(code: string) {
    const l = await this.getLive(code)
    if (!l) return null
    return { code: l.code, status: l.status, quizTitle: l.quizTitle }
  }

  async join(code: string, rawName: string, rawNick: string) {
    const l = await this.getLive(code)
    if (!l) throw new EngineError('NO_SESSION', 'Code de session inconnu.', 404)
    if (l.status === 'ENDED') throw new EngineError('ENDED', 'Cette session est terminée.', 410)
    const fullName = titleCase(tidy(rawName))
    const nickname = tidy(rawNick)
    const nicknameKey = normalizeNickname(nickname)
    const taken = 'Ce pseudo est déjà pris dans cette session. Si c’est le tien, demande au professeur de réinitialiser ton accès.'
    return this.withLock(l, async () => {
      const token = newToken()
      const tokenHash = hashToken(token)
      const existing = [...l.participants.values()].find((p) => p.nicknameKey === nicknameKey)
      if (existing) {
        if (!existing.claimable || fold(existing.fullName) !== fold(fullName)) throw new EngineError('DUPLICATE', taken, 409)
        await prisma.participant.update({ where: { id: existing.id }, data: { tokenHash, claimable: false } })
        existing.claimable = false
        this.tokens.set(tokenHash, { sessionId: l.id, participantId: existing.id })
        this.hub.broadcastState(l)
        return { token, code: l.code }
      }
      try {
        const p = await prisma.participant.create({ data: { sessionId: l.id, fullName, nickname, nicknameKey, tokenHash } })
        l.participants.set(p.id, { id: p.id, fullName, nickname, nicknameKey, totalScore: 0, claimable: false })
        l.ranks = undefined
        this.tokens.set(tokenHash, { sessionId: l.id, participantId: p.id })
        this.touchCounts(l)
        this.hub.broadcastState(l)
        return { token, code: l.code }
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new EngineError('DUPLICATE', taken, 409)
        throw e
      }
    })
  }

  async authenticate(token: string): Promise<{ live: Live; participantId: string } | null> {
    const h = hashToken(token)
    let t = this.tokens.get(h)
    if (!t) {
      const p = await prisma.participant.findUnique({ where: { tokenHash: h }, select: { id: true, sessionId: true } })
      if (!p) return null
      t = { sessionId: p.sessionId, participantId: p.id }
      this.tokens.set(h, t)
    }
    const live = await this.getLive(t.sessionId)
    if (!live || !live.participants.has(t.participantId)) return null
    return { live, participantId: t.participantId }
  }

  async submit(l: Live, participantId: string, questionId: string, choiceIndex: number) {
    const receivedAt = Date.now()
    const q = this.cur(l)
    if (!q || q.id !== questionId) throw new EngineError('NO_QUESTION', 'Cette question n’est plus active.')
    const prev = l.answers.get(participantId)
    if (prev) return { choiceIndex: prev.choiceIndex, already: true }
    if (l.status !== 'OPEN' || q.status !== 'OPEN' || l.closing) throw new EngineError('CLOSED', 'La question est terminée.')
    if (receivedAt >= q.deadlineAt!) throw new EngineError('LATE', 'Trop tard : le temps est écoulé.')
    if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= q.options.length) throw new EngineError('BAD_CHOICE', 'Réponse invalide.')

    const elapsedMs = receivedAt - q.openedAt!
    const correct = q.correctIndex !== null && choiceIndex === q.correctIndex
    const points = pointsFor(correct, elapsedMs, q.durationSec)
    const work = (async () => {
      const r = await prisma.answer.createMany({
        data: [{ questionId: q.id, participantId, choiceIndex, receivedAt: new Date(receivedAt), elapsedMs, correct, points }],
        skipDuplicates: true,
      })
      if (r.count === 1) {
        l.answers.set(participantId, { choiceIndex, points, correct })
        this.touchCounts(l)
        return { choiceIndex, already: false }
      }
      const ex = await prisma.answer.findUniqueOrThrow({ where: { questionId_participantId: { questionId: q.id, participantId } } })
      l.answers.set(participantId, { choiceIndex: ex.choiceIndex, points: ex.points, correct: ex.correct })
      return { choiceIndex: ex.choiceIndex, already: true }
    })()
    l.inflight.add(work)
    try { return await work } finally { l.inflight.delete(work) }
  }
}

export const engine = new Engine()
export type { Live }
