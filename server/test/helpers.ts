import { io, type Socket } from 'socket.io-client'
import type { AddressInfo } from 'node:net'
import { createApp } from '../src/app.js'
import { prisma } from '../src/db.js'
import bcrypt from 'bcryptjs'

export async function startApp() {
  const a = await createApp()
  await new Promise<void>((r) => a.http.listen(0, r))
  const port = (a.http.address() as AddressInfo).port
  return { ...a, base: `http://localhost:${port}` }
}
export type App = Awaited<ReturnType<typeof startApp>>

export async function api(app: App, method: string, path: string, body?: unknown, token?: string) {
  const r = await fetch(app.base + '/api' + path, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const text = await r.text()
  let json: any; try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json, text }
}

export async function makeTeacher(app: App, email = `t${Date.now()}${Math.random()}@x.fr`) {
  await prisma.teacher.create({ data: { email, name: 'Prof', passwordHash: await bcrypt.hash('secret123', 4) } })
  const r = await api(app, 'POST', '/auth/login', { email, password: 'secret123' })
  return r.json.token as string
}

export const sampleQuiz = (n = 2) => ({
  title: 'Quiz test',
  questions: Array.from({ length: n }, (_, i) => ({ text: `Question ${i + 1} ?`, options: ['A', 'B', 'C'], correctIndex: 1, durationSec: 10, explanation: 'Parce que.' })),
})

export function connect(app: App, auth: Record<string, unknown>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = io(app.base, { auth, transports: ['websocket'], reconnection: false })
    ;(s as any).last = {}
    s.onAny((ev, x) => { (s as any).last[ev] = x })
    s.on('connect', () => resolve(s))
    s.on('connect_error', (e) => { s.close(); reject(e) })
  })
}
export const emit = <T = any>(s: Socket, ev: string, payload?: unknown) => new Promise<T>((res) => s.emit(ev, payload, res))
export const waitFor = <T = any>(s: Socket, ev: string, pred: (x: T) => boolean = () => true, ms = 15000) =>
  new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error('timeout ' + ev)), ms)
    const h = (x: T) => { if (pred(x)) { clearTimeout(t); s.off(ev, h); res(x) } }
    s.on(ev, h)
    const prev = (s as any).last?.[ev]
    if (prev !== undefined) h(prev)
  })
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function setupSession(app: App, durationSec?: number, questions = 2) {
  const tt = await makeTeacher(app)
  const q = await api(app, 'POST', '/quizzes', sampleQuiz(questions), tt)
  const s = await api(app, 'POST', '/sessions', { quizId: q.json.id }, tt)
  if (durationSec) await prisma.sessionQuestion.updateMany({ where: { sessionId: s.json.id }, data: { durationSec } })
  return { tt, sessionId: s.json.id as string, code: s.json.code as string }
}
export async function joinStudent(app: App, code: string, i: number) {
  const r = await api(app, 'POST', '/public/join', { code, fullName: `Prénom${i} Nom${i}`, nickname: `Pseudo${i}` })
  return r
}

/** Donne un abonnement en cours à un étudiant (l'accès à Study en dépend). */
export async function subscribe(studentId: string, plan: 'MONTHLY' | 'YEARLY' = 'MONTHLY') {
  const p = await prisma.studentPayment.create({ data: { studentId, plan, amount: plan === 'YEARLY' ? 10000 : 1000, reference: `T-${Math.random().toString(36).slice(2)}`, status: 'COMPLETED', paidAt: new Date() } })
  return prisma.subscription.create({ data: { studentId, plan, startsAt: new Date(), endsAt: new Date(Date.now() + 30 * 86400_000), paymentId: p.id } })
}
