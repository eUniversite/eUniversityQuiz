import crypto from 'node:crypto'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../src/config.js'
import { prisma } from '../src/db.js'
import { googleVerifier } from '../src/google.js'
import { api, startApp, subscribe, type App } from './helpers.js'

let app: App
beforeAll(async () => { app = await startApp() })
afterEach(() => vi.restoreAllMocks())

async function student() {
  const email = `etu${Date.now()}${Math.random()}@x.fr`
  const r = await api(app, 'POST', '/student/signup', { email, password: 'motdepasse1', acceptedTerms: true })
  expect(r.status).toBe(201)
  return { email, id: r.json.user.id as string, token: r.json.token as string }
}

async function courseWith(studentId: string, missions = 5) {
  const course = await prisma.studyCourse.create({ data: { studentId, fileName: 'c.txt', title: 'Cours', status: 'READY',
    analysis: { usable: true, title: 'Cours', summary: '', unit: 'section', missions: Array.from({ length: missions }, (_, i) => ({ title: `M${i + 1}`, startPage: i + 1, endPage: i + 1, notions: [] })) } } })
  const qs = []
  for (let i = 0; i < missions * 2; i++) qs.push(await prisma.studyQuestion.create({ data: { courseId: course.id, missionId: `m${Math.floor(i / 2) + 1}`, position: i, kind: 'rappel', text: `Q${i} ?`, choices: ['a', 'b', 'c', 'd'], answerIndex: 1, explanation: 'x', sourcePage: 1, sourceExcerpt: 'extrait', verified: true } }))
  return { course, qs }
}

describe('Plan Découverte', () => {
  it('limite la taille du fichier à 2 Mo, et 10 Mo pour un abonné', async () => {
    const s = await student()
    const send = (token: string, mb: number) => {
      const f = new FormData(); f.append('file', new Blob([new Uint8Array(mb * 1024 * 1024)]), 'c.txt')
      return fetch(`${app.base}/api/study/courses`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: f })
    }
    const big = await send(s.token, 3)
    expect(big.status).toBe(413)
    expect((await big.json()).code).toBe('PLAN_LIMIT')
    await subscribe(s.id)
    expect((await send(s.token, 3)).status).not.toBe(413) // 503 sans clé du modèle : la taille est acceptée
  })

  it('autorise un seul cours, un import raté ne compte pas, un abonné n’a pas de limite', async () => {
    const s = await student()
    const f = () => { const x = new FormData(); x.append('file', new Blob(['texte']), 'c.txt'); return x }
    const post = () => fetch(`${app.base}/api/study/courses`, { method: 'POST', headers: { authorization: `Bearer ${s.token}` }, body: f() })
    const failed = await prisma.studyCourse.create({ data: { studentId: s.id, fileName: 'x.txt', status: 'FAILED' } })
    expect((await post()).status).not.toBe(402)
    await prisma.studyCourse.delete({ where: { id: failed.id } })
    await courseWith(s.id, 1)
    const r = await post()
    expect(r.status).toBe(402)
    expect((await r.json()).code).toBe('PLAN_LIMIT')
    await subscribe(s.id)
    expect((await post()).status).not.toBe(402)
  })

  it('ne donne que les 3 premières missions, et verrouille les autres', async () => {
    const s = await student()
    const { course, qs } = await courseWith(s.id, 5)
    const game = (await api(app, 'GET', `/study/courses/${course.id}/game`, undefined, s.token)).json
    expect(game.plan).toBe('free')
    expect(game.lockedMissions).toBe(2)
    expect(game.missions.map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(game.questions.every((q: any) => ['m1', 'm2', 'm3'].includes(q.missionId))).toBe(true)
    expect((await api(app, 'GET', `/study/courses/${course.id}/game?mission=m4`, undefined, s.token)).json.code).toBe('PLAN_LIMIT')
    expect((await api(app, 'GET', `/study/courses/${course.id}/game?mission=m3`, undefined, s.token)).status).toBe(200)

    const progress = (await api(app, 'GET', `/study/courses/${course.id}/progress`, undefined, s.token)).json
    expect(progress.missions.map((m: any) => m.planLocked)).toEqual([false, false, false, true, true])

    // Une partie sur une mission verrouillée est refusée ; sur une mission ouverte elle est enregistrée.
    const locked = qs.filter((q) => q.missionId === 'm4')
    const bad = await api(app, 'POST', `/study/courses/${course.id}/sessions`, { scope: 'mission:m4', answers: locked.map((q) => ({ questionId: q.id, chosen: 1 })) }, s.token)
    expect(bad.status).toBe(400)
    const open = qs.filter((q) => q.missionId === 'm1')
    expect((await api(app, 'POST', `/study/courses/${course.id}/sessions`, { scope: 'mission:m1', answers: open.map((q) => ({ questionId: q.id, chosen: 1 })) }, s.token)).status).toBe(201)

    await subscribe(s.id)
    const full = (await api(app, 'GET', `/study/courses/${course.id}/game`, undefined, s.token)).json
    expect(full.plan).toBe('paid')
    expect(full.missions).toHaveLength(5)
  })
})

describe('Connexion Google', () => {
  it('est désactivée sans identifiant client', async () => {
    config.googleClientId = ''
    expect((await api(app, 'POST', '/auth/google', { credential: 'x'.repeat(30) })).status).toBe(503)
  })

  it('crée un compte, puis reconnaît le même ; lie un compte e-mail existant ; refuse un jeton invalide', async () => {
    config.googleClientId = 'client-test'
    const email = `g${Date.now()}${Math.random()}@x.fr`
    const verify = vi.spyOn(googleVerifier, 'verify').mockResolvedValue({ sub: 'g-' + email, email, name: 'Awa Koné' })
    const first = await api(app, 'POST', '/auth/google', { credential: 'x'.repeat(30) })
    expect(first.status).toBe(200)
    expect(first.json.user.name).toBe('Awa Koné')
    expect((await api(app, 'GET', '/student/me', undefined, first.json.token)).json.limits.plan).toBe('free')
    expect((await api(app, 'POST', '/auth/google', { credential: 'x'.repeat(30) })).json.user.id).toBe(first.json.user.id)
    // compte sans mot de passe : la connexion classique est refusée
    expect((await api(app, 'POST', '/session/login', { email, password: 'motdepasse1' })).status).toBe(401)

    const e = await student()
    verify.mockResolvedValue({ sub: 'g-link-' + e.email, email: e.email, name: 'X' })
    expect((await api(app, 'POST', '/auth/google', { credential: 'x'.repeat(30) })).json.user.id).toBe(e.id)
    expect((await prisma.student.findUnique({ where: { id: e.id } }))!.googleId).toBe('g-link-' + e.email)

    verify.mockRejectedValue(new Error('jeton invalide'))
    expect((await api(app, 'POST', '/auth/google', { credential: 'x'.repeat(30) })).status).toBe(401)
    config.googleClientId = ''
  })
})

describe('SSO interne (OpenID Connect)', () => {
  const REDIRECT = 'https://app.example/callback'
  const form = (o: Record<string, string>) => new URLSearchParams(o).toString()
  const token = (body: Record<string, string>, headers: Record<string, string> = {}) =>
    fetch(`${app.base}/api/sso/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: form(body) })

  beforeAll(() => { config.ssoClients.push({ id: 'activate', secret: 'sec', redirectUris: [REDIRECT] }, { id: 'public-app', redirectUris: [REDIRECT] }) })

  async function authorize(token: string, extra: Record<string, string> = {}) {
    const r = await api(app, 'POST', '/sso/authorize', { client_id: 'activate', redirect_uri: REDIRECT, state: 'abc', ...extra }, token)
    return r
  }

  it('publie la découverte et les clés, et refuse une application ou une adresse inconnue', async () => {
    const d = (await api(app, 'GET', '/sso/.well-known/openid-configuration')).json
    expect(d.id_token_signing_alg_values_supported).toEqual(['RS256'])
    expect((await api(app, 'GET', '/sso/jwks.json')).json.keys[0].kty).toBe('RSA')
    const s = await student()
    expect((await authorize(s.token, { client_id: 'inconnu' })).status).toBe(400)
    expect((await authorize(s.token, { redirect_uri: 'https://evil.example/cb' })).status).toBe(400)
    expect((await api(app, 'POST', '/sso/authorize', { client_id: 'activate', redirect_uri: REDIRECT })).status).toBe(401)
  })

  it('échange le code une seule fois et signe un id_token vérifiable', async () => {
    const s = await student()
    const a = await authorize(s.token, { nonce: 'n-1' })
    expect(a.status).toBe(200)
    const url = new URL(a.json.redirectTo)
    expect(url.searchParams.get('state')).toBe('abc')
    const code = url.searchParams.get('code')!

    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'activate', client_secret: 'mauvais' })).status).toBe(401)
    const ok = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }, { authorization: 'Basic ' + Buffer.from('activate:sec').toString('base64') })
    expect(ok.status).toBe(200)
    const t = await ok.json()
    const jwks = (await api(app, 'GET', '/sso/jwks.json')).json.keys[0]
    const jwt = (await import('jsonwebtoken')).default
    const claims = jwt.verify(t.id_token, crypto.createPublicKey({ key: jwks, format: 'jwk' }), { algorithms: ['RS256'], audience: 'activate' }) as any
    expect(claims).toMatchObject({ sub: s.id, email: s.email, nonce: 'n-1', plan: 'free', email_verified: true })
    const info = await api(app, 'GET', '/sso/userinfo', undefined, t.access_token)
    expect(info.json).toMatchObject({ sub: s.id, email: s.email })
    expect((await api(app, 'GET', '/sso/userinfo', undefined, 'faux')).status).toBe(401)

    // le même code ne sert qu'une fois
    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'activate', client_secret: 'sec' })).status).toBe(400)
  })

  it('exige PKCE pour une application sans secret et le vérifie', async () => {
    const s = await student()
    expect((await authorize(s.token, { client_id: 'public-app' })).status).toBe(400)
    const verifier = crypto.randomBytes(32).toString('base64url')
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
    const a = await authorize(s.token, { client_id: 'public-app', code_challenge: challenge, code_challenge_method: 'S256' })
    const code = new URL(a.json.redirectTo).searchParams.get('code')!
    const base = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'public-app' }
    expect((await token({ ...base, code_verifier: 'faux' })).status).toBe(400)
    expect((await token({ ...base, code_verifier: verifier })).status).toBe(200)
  })

  it('refuse un code expiré ou présenté avec une autre adresse de retour', async () => {
    const s = await student()
    const code = new URL((await authorize(s.token)).json.redirectTo).searchParams.get('code')!
    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: 'https://autre.example', client_id: 'activate', client_secret: 'sec' })).status).toBe(400)
    await prisma.ssoCode.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } })
    expect((await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'activate', client_secret: 'sec' })).status).toBe(400)
  })
})
