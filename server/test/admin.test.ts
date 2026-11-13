import bcrypt from 'bcryptjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { bootstrapAdmin } from '../src/admin.js'
import { config } from '../src/config.js'
import { prisma } from '../src/db.js'
import { api, startApp, type App } from './helpers.js'

let app: App
beforeAll(async () => { app = await startApp() })

const PASSWORD = 'un-mot-de-passe-solide'
async function admin(disabled = false) {
  const email = `adm${Date.now()}${Math.random()}@x.fr`
  await prisma.admin.create({ data: { email, name: 'Admin', passwordHash: await bcrypt.hash(PASSWORD, 4), disabledAt: disabled ? new Date() : null } })
  return { email, token: (await api(app, 'POST', '/admin/login', { email, password: PASSWORD })).json.token as string }
}
async function teacherToken() {
  const email = `t${Date.now()}${Math.random()}@x.fr`
  await prisma.teacher.create({ data: { email, name: 'T', passwordHash: await bcrypt.hash('secret123', 4), emailVerifiedAt: new Date() } })
  return (await api(app, 'POST', '/auth/login', { email, password: 'secret123' })).json.token as string
}
async function student() {
  const r = await api(app, 'POST', '/student/signup', { email: `s${Date.now()}${Math.random()}@x.fr`, password: 'motdepasse1', acceptedTerms: true })
  return { id: r.json.user.id as string, email: r.json.user.email as string, token: r.json.token as string }
}

describe('Administrateur de démarrage (sans terminal)', () => {
  it('crée le compte une fois, ne l’écrase pas, le réinitialise sur demande et refuse un mot de passe court', async () => {
    const email = `boot${Date.now()}@x.fr`
    Object.assign(config, { adminBootstrapEmail: email, adminBootstrapPassword: 'mot-de-passe-initial', adminBootstrapReset: false })
    expect(await bootstrapAdmin()).toBe('created')
    expect((await api(app, 'POST', '/admin/login', { email, password: 'mot-de-passe-initial' })).status).toBe(200)

    const token = (await api(app, 'POST', '/admin/login', { email, password: 'mot-de-passe-initial' })).json.token
    await api(app, 'POST', '/admin/password', { current: 'mot-de-passe-initial', next: 'mot-de-passe-modifie' }, token)
    expect(await bootstrapAdmin()).toBe('exists') // le redémarrage ne remet pas l'ancien mot de passe
    expect((await api(app, 'POST', '/admin/login', { email, password: 'mot-de-passe-modifie' })).status).toBe(200)

    config.adminBootstrapReset = true
    expect(await bootstrapAdmin()).toBe('reset')
    expect((await api(app, 'POST', '/admin/login', { email, password: 'mot-de-passe-initial' })).status).toBe(200)

    Object.assign(config, { adminBootstrapPassword: 'court', adminBootstrapReset: false, adminBootstrapEmail: `x${email}` })
    expect(await bootstrapAdmin()).toBe('skipped')
    Object.assign(config, { adminBootstrapEmail: '', adminBootstrapPassword: '' })
  })
})

describe('Backoffice', () => {
  it('a sa propre connexion : mauvais mot de passe, compte inconnu ou désactivé refusés', async () => {
    const a = await admin()
    expect(a.token).toBeTruthy()
    expect((await api(app, 'POST', '/admin/login', { email: a.email, password: 'faux' })).status).toBe(401)
    expect((await api(app, 'POST', '/admin/login', { email: 'inconnu@x.fr', password: PASSWORD })).status).toBe(401)
    const off = await admin(true)
    expect(off.token).toBeUndefined()
    const logs = await prisma.adminLog.findMany({ where: { adminEmail: a.email } })
    expect(logs.map((l) => l.action).sort()).toEqual(['login', 'login.echec'])
  })

  it('refuse sans jeton admin : ni enseignant, ni étudiant', async () => {
    expect((await api(app, 'GET', '/admin/me')).status).toBe(401)
    expect((await api(app, 'GET', '/admin/me', undefined, await teacherToken())).status).toBe(401)
    expect((await api(app, 'GET', '/admin/me', undefined, (await student()).token)).status).toBe(401)
    const a = await admin()
    expect((await api(app, 'GET', '/admin/me', undefined, a.token)).json.email).toBe(a.email)
    // un jeton admin n'ouvre ni l'espace enseignant ni l'espace étudiant
    expect((await api(app, 'GET', '/quizzes', undefined, a.token)).status).toBe(401)
    expect((await api(app, 'GET', '/student/me', undefined, a.token)).status).toBe(401)
  })

  it('change le mot de passe (12 caractères minimum) et invalide les anciens jetons ; désactiver coupe l’accès', async () => {
    const a = await admin()
    expect((await api(app, 'POST', '/admin/password', { current: PASSWORD, next: 'court' }, a.token)).status).toBe(400)
    expect((await api(app, 'POST', '/admin/password', { current: 'faux', next: 'nouveau-mot-de-passe' }, a.token)).status).toBe(400)
    const ch = await api(app, 'POST', '/admin/password', { current: PASSWORD, next: 'nouveau-mot-de-passe' }, a.token)
    expect(ch.status).toBe(200)
    expect((await api(app, 'GET', '/admin/me', undefined, a.token)).status).toBe(401)
    expect((await api(app, 'GET', '/admin/me', undefined, ch.json.token)).status).toBe(200)
    await prisma.admin.update({ where: { email: a.email }, data: { disabledAt: new Date() } })
    expect((await api(app, 'GET', '/admin/me', undefined, ch.json.token)).status).toBe(401)
  })

  it('donne les chiffres, cherche un étudiant, offre un abonnement, suspend un compte et journalise', async () => {
    const adm = await admin(); const t = adm.token
    const s = await student()
    const stats = (await api(app, 'GET', '/admin/stats', undefined, t)).json
    expect(stats.students).toBeGreaterThan(0)
    expect(stats.signups).toHaveLength(14)

    const found = (await api(app, 'GET', `/admin/students?q=${encodeURIComponent(s.email)}`, undefined, t)).json
    expect(found.items).toHaveLength(1)
    expect(found.items[0]).toMatchObject({ plan: null, blocked: false })

    expect((await api(app, 'POST', `/admin/students/${s.id}/grant`, { plan: 'YEARLY' }, t)).status).toBe(201)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).json.limits.plan).toBe('paid')
    const pays = (await api(app, 'GET', '/admin/payments?status=COMPLETED', undefined, t)).json.items.filter((p: any) => p.email === s.email)
    expect(pays).toMatchObject([{ offered: true, amount: 0 }])
    expect((await api(app, 'GET', '/admin/stats', undefined, t)).json.revenue).toBe(stats.revenue)

    expect((await api(app, 'POST', `/admin/students/${s.id}/block`, { blocked: true }, t)).status).toBe(200)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).status).toBe(401)
    expect((await api(app, 'POST', '/session/login', { email: s.email, password: 'motdepasse1' })).status).toBe(403)
    await api(app, 'POST', `/admin/students/${s.id}/block`, { blocked: false }, t)
    expect((await api(app, 'POST', '/session/login', { email: s.email, password: 'motdepasse1' })).status).toBe(200)

    const actions = (await prisma.adminLog.findMany({ where: { adminEmail: adm.email } })).map((l) => l.action)
    expect(actions).toEqual(expect.arrayContaining(['login', 'abonnement.offrir', 'etudiant.suspendre', 'etudiant.reactiver']))
    expect((await api(app, 'GET', '/admin/logs', undefined, t)).json.items.length).toBeGreaterThan(0)
  })
})
