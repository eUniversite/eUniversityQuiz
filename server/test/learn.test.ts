import { describe, expect, it } from 'vitest'
import { prisma } from '../src/db.js'
import { api, startApp, subscribe } from './helpers.js'

/** Parcours Study sans appel au modèle : le cours est créé en base, le reste passe par l'API réelle. */
async function setup() {
  const app = await startApp()
  const email = `etu${Date.now()}${Math.random()}@x.fr`
  const su = await api(app, 'POST', '/student/signup', { email, password: 'motdepasse1', acceptedTerms: true })
  expect(su.status).toBe(201)
  await subscribe(su.json.user.id)
  const token = su.json.token as string
  const course = await prisma.studyCourse.create({
    data: {
      studentId: su.json.user.id, fileName: 'c.txt', title: 'Cours', status: 'READY',
      analysis: { usable: true, title: 'Cours', summary: '', unit: 'section', missions: [{ title: 'Un', startPage: 1, endPage: 1, notions: [] }, { title: 'Deux', startPage: 2, endPage: 2, notions: [] }] },
    },
  })
  const qs = []
  for (let i = 0; i < 4; i++) {
    qs.push(await prisma.studyQuestion.create({
      data: { courseId: course.id, missionId: i < 2 ? 'm1' : 'm2', position: i, kind: 'rappel', text: `Question ${i} ?`, choices: ['a', 'b', 'c', 'd'], answerIndex: 1, explanation: 'x', sourcePage: 1, sourceExcerpt: 'extrait de test', verified: true },
    }))
  }
  return { app, token, course, qs }
}

describe('Learn Engine (API)', () => {
  it('le serveur recalcule XP et étoiles, ouvre la mission suivante et planifie les rappels', async () => {
    const { app, token, course, qs } = await setup()
    const base = `/study/courses/${course.id}`
    let p = (await api(app, 'GET', `${base}/progress`, undefined, token)).json
    expect(p.missions.map((m: any) => [m.id, m.state, m.locked])).toEqual([['m1', 'a_decouvrir', false], ['m2', 'a_decouvrir', true]])

    // Mission 1 : 2 bonnes réponses sur 2 → 3 étoiles ; le navigateur n'envoie aucun XP, le serveur le calcule.
    const s = await api(app, 'POST', `${base}/sessions`, { scope: 'mission:m1', answers: [{ questionId: qs[0].id, chosen: 1 }, { questionId: qs[1].id, chosen: 1 }], coins: 5 }, token)
    expect(s.status).toBe(201)
    expect(s.json).toMatchObject({ xp: 225, stars: 3, correct: 2, total: 2, victory: true, totalXp: 225, level: 1, unlocked: ['m2'], nextMissionId: 'm2' })
    p = (await api(app, 'GET', `${base}/progress`, undefined, token)).json
    expect(p.missions[0]).toMatchObject({ stars: 3, state: 'a_consolider', plays: 1 })
    expect(p.missions[1].locked).toBe(false)

    // Une erreur : rappel dû dès le lendemain, pas avant.
    const bad = await api(app, 'POST', `${base}/sessions`, { scope: 'mission:m2', answers: [{ questionId: qs[2].id, chosen: 0 }, { questionId: qs[3].id, chosen: 1 }] }, token)
    expect(bad.json).toMatchObject({ correct: 1, stars: 1 })
    const st = await prisma.studyNotionState.findMany({ where: { courseId: course.id } })
    const wrong = st.find((x) => x.notionKey === 'm:m2')!                       // ancien cours : la mission m2 joue le rôle de notion
    expect(wrong.lastCorrect).toBe(false)
    expect(wrong.dueAt.getTime() - Date.now()).toBeGreaterThan(23 * 3600_000)
    expect((await api(app, 'GET', '/study/stats', undefined, token)).json).toMatchObject({ due: 0, streakDays: 1, sessions: 2 })

    // Révision : rien de dû maintenant.
    expect((await api(app, 'GET', `${base}/game?review=1`, undefined, token)).status).toBe(409)
    await prisma.studyNotionState.updateMany({ where: { courseId: course.id, notionKey: 'm:m2' }, data: { dueAt: new Date(Date.now() - 1000) } })
    const rv = await api(app, 'GET', `${base}/game?review=1`, undefined, token)
    expect(rv.json.questions).toHaveLength(1)
    expect(rv.json.questions[0].id).toBe(qs[2].id)                              // la dernière posée (qs[3], réussie) est écartée : la question ratée revient
    expect((await api(app, 'GET', '/study/stats', undefined, token)).json).toMatchObject({ due: 1 })
    expect(rv.json.scope).toBe('review')
    expect(rv.json.questions[0].excerpt).toBe('extrait de test')                  // le passage du cours accompagne la question
    // Mon évolution : une notion (mission m2, ancien cours) est ratée donc à retravailler ; rien n'est encore maîtrisé.
    const ev = (await api(app, 'GET', '/study/evolution', undefined, token)).json
    expect(ev).toMatchObject({ notions: 2, mastered: 0, pct: 0, streakDays: 1, due: 1 })
    expect(ev.weak.map((w: any) => w.state)).toEqual(['en_cours'])
    expect(ev.week).toHaveLength(7)
    expect(ev.week[6].played).toBe(true)
    app.http.close()
  })

  it('refuse les parties falsifiées', async () => {
    const { app, token, course, qs } = await setup()
    const url = `/study/courses/${course.id}/sessions`
    const post = (body: unknown) => api(app, 'POST', url, body, token)
    expect((await post({ scope: 'course', answers: [{ questionId: qs[0].id, chosen: 1 }, { questionId: qs[0].id, chosen: 1 }] })).status).toBe(400)   // doublon
    expect((await post({ scope: 'course', answers: [{ questionId: 'inconnue', chosen: 1 }] })).status).toBe(400)
    expect((await post({ scope: 'course', answers: [{ questionId: qs[0].id, chosen: 9 }] })).status).toBe(400)
    expect((await post({ scope: 'mission:m2', answers: [{ questionId: qs[0].id, chosen: 1 }] })).status).toBe(400)  // question d'une autre mission
    expect((await post({ scope: 'nimporte', answers: [{ questionId: qs[0].id, chosen: 1 }] })).status).toBe(400)
    // Le cours d'un autre étudiant reste invisible.
    const other = await api(app, 'POST', '/student/signup', { email: `o${Date.now()}@x.fr`, password: 'motdepasse1', acceptedTerms: true })
    await subscribe(other.json.user.id)
    expect((await api(app, 'POST', url, { scope: 'course', answers: [{ questionId: qs[0].id, chosen: 1 }] }, other.json.token)).status).toBe(404)
    expect((await api(app, 'GET', `/study/courses/${course.id}/progress`, undefined, other.json.token)).status).toBe(404)
    app.http.close()
  })
})
