import bcrypt from 'bcryptjs'
import { beforeAll, describe, expect, it } from 'vitest'
import { config } from '../src/config.js'
import { prisma } from '../src/db.js'
import { api, startApp, type App } from './helpers.js'

let app: App
beforeAll(async () => { app = await startApp() })

async function teacher(verified: boolean, admin: boolean) {
  const email = `adm${Date.now()}${Math.random()}@x.fr`
  await prisma.teacher.create({ data: { email, name: 'A', passwordHash: await bcrypt.hash('secret123', 4), emailVerifiedAt: verified ? new Date() : null } })
  if (admin) config.adminEmails.push(email)
  return (await api(app, 'POST', '/auth/login', { email, password: 'secret123' })).json.token as string
}
async function student() {
  const r = await api(app, 'POST', '/student/signup', { email: `s${Date.now()}${Math.random()}@x.fr`, password: 'motdepasse1', acceptedTerms: true })
  return { id: r.json.user.id as string, email: r.json.user.email as string, token: r.json.token as string }
}

describe('Backoffice', () => {
  it('refuse les non-admins, les admins non vérifiés et les étudiants', async () => {
    expect((await api(app, 'GET', '/admin/me')).status).toBe(401)
    expect((await api(app, 'GET', '/admin/me', undefined, await teacher(true, false))).status).toBe(403)
    expect((await api(app, 'GET', '/admin/me', undefined, await teacher(false, true))).status).toBe(403)
    expect((await api(app, 'GET', '/admin/me', undefined, (await student()).token)).status).toBe(401)
    expect((await api(app, 'GET', '/admin/me', undefined, await teacher(true, true))).status).toBe(200)
  })

  it('donne les chiffres, cherche un étudiant, offre un abonnement et suspend un compte', async () => {
    const t = await teacher(true, true)
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
    expect((await api(app, 'GET', '/admin/stats', undefined, t)).json.revenue).toBe(stats.revenue) // l'offert ne compte pas dans le chiffre d'affaires

    expect((await api(app, 'POST', `/admin/students/${s.id}/block`, { blocked: true }, t)).status).toBe(200)
    expect((await api(app, 'GET', '/student/me', undefined, s.token)).status).toBe(401)
    expect((await api(app, 'POST', '/session/login', { email: s.email, password: 'motdepasse1' })).status).toBe(403)
    await api(app, 'POST', `/admin/students/${s.id}/block`, { blocked: false }, t)
    expect((await api(app, 'POST', '/session/login', { email: s.email, password: 'motdepasse1' })).status).toBe(200)
  })
})
