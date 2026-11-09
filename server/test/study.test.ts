import { describe, expect, it } from 'vitest'
import { applyVerdicts, normalizeMissions, shuffleChoices, validateQuestions } from '../src/study/pipeline.js'

const q = (over: Record<string, unknown> = {}) => ({
  notionIndex: 0, level: 1, question: 'Que signifie le principe KISS ?', choices: ['Garder simple', 'Tout détailler', 'Ajouter des options', 'Copier le code'], answerIndex: 0,
  explanation: 'KISS invite à rester simple.', sourcePage: 1, sourceExcerpt: 'Le principe KISS demande de garder les choses simples', ...over,
})
const pages = ['Le principe KISS demande de garder les choses simples et lisibles pour tous.']

describe('normalizeMissions', () => {
  const m = (o: Record<string, unknown>) => ({ title: 'M', notions: [], ...o }) as any
  it('ramène les bornes dans le document', () => {
    expect(normalizeMissions([m({ startPage: -3, endPage: 99 })], 10)[0]).toMatchObject({ startPage: 1, endPage: 10 })
  })
  it('déduit la plage des notions si elle manque ou est incohérente', () => {
    const notions = [{ label: 'a', page: 4, excerpt: '' }, { label: 'b', page: 6, excerpt: '' }]
    expect(normalizeMissions([m({ notions, startPage: 9, endPage: 2 })], 10)[0]).toMatchObject({ startPage: 4, endPage: 6 })
  })
  it('répartit à égalité en dernier recours', () => {
    const r = normalizeMissions([m({}), m({})], 10)
    expect([r[0].startPage, r[0].endPage, r[1].startPage, r[1].endPage]).toEqual([1, 5, 6, 10])
  })
})

describe('validateQuestions', () => {
  it('garde une question valide', () => {
    expect(validateQuestions([q()], pages, 1, 1).kept).toHaveLength(1)
  })
  it('écarte une citation introuvable dans le texte', () => {
    expect(validateQuestions([q({ sourceExcerpt: 'Une phrase qui ne figure nulle part dans ce cours' })], pages, 1, 1).kept).toHaveLength(0)
  })
  it('écarte « toutes les réponses », les propositions en double et les doublons de question', () => {
    expect(validateQuestions([q({ choices: ['A', 'B', 'C', 'Toutes les réponses'] })], pages, 1, 1).kept).toHaveLength(0)
    expect(validateQuestions([q({ choices: ['A', 'a', 'C', 'D'] })], pages, 1, 1).kept).toHaveLength(0)
    expect(validateQuestions([q(), q()], pages, 1, 1).kept).toHaveLength(1)
  })
  it('une seule question par notion et par niveau, et une notion qui existe', () => {
    const a = q(), b = q({ question: 'Autre formulation de la question KISS ?', level: 2 }), c = q({ question: 'Troisième question sur KISS ?', level: 1 })
    expect(validateQuestions([a, b, c], pages, 1, 1).kept.map((x) => x.level)).toEqual([1, 2])   // c : même notion et même niveau que a
    expect(validateQuestions([q({ notionIndex: 3 })], pages, 1, 2).kept).toHaveLength(0)
  })
  it('respecte la numérotation d’origine (mission qui ne commence pas à la page 1)', () => {
    const r = validateQuestions([q({ sourcePage: 7 })], pages, 7, 1).kept
    expect(r[0].sourcePage).toBe(7)
  })
})

describe('applyVerdicts', () => {
  const list = [q(), q({ question: 'Seconde question assez longue ?' })] as any
  it('ne garde que les questions où la relecture retrouve la même réponse, établie et non ambiguë', () => {
    const out = applyVerdicts(list, [
      { index: 0, answerIndex: 0, supported: true, ambiguous: false },
      { index: 1, answerIndex: 2, supported: true, ambiguous: false },
    ])
    expect(out).toHaveLength(1)
  })
  it('écarte les réponses non étayées ou ambiguës, et les questions sans verdict', () => {
    expect(applyVerdicts(list, [{ index: 0, answerIndex: 0, supported: false, ambiguous: false }])).toHaveLength(0)
    expect(applyVerdicts(list, [{ index: 0, answerIndex: 0, supported: true, ambiguous: true }])).toHaveLength(0)
    expect(applyVerdicts(list, undefined)).toHaveLength(0)
  })
})

describe('shuffleChoices', () => {
  it('garde la bonne réponse attachée à la bonne proposition', () => {
    for (let i = 0; i < 50; i++) {
      const s = shuffleChoices({ choices: ['a', 'b', 'c', 'd'], answerIndex: 2 })
      expect(s.choices[s.answerIndex]).toBe('c')
      expect([...s.choices].sort()).toEqual(['a', 'b', 'c', 'd'])
    }
  })
})

import { missionStateOf, nextReview, notionState, notionKeyOf, pickReview, sampleRun, scoreAnswers, starsFor, DAY, levelOf } from '../src/study/learn.js'

describe('Learn Engine', () => {
  const t0 = new Date('2026-11-01T10:00:00Z')
  const at = (days: number) => new Date(t0.getTime() + days * DAY)
  const win = (sessionId: string, days: number) => ({ correct: true, unassisted: true, sessionId, at: at(days) })
  const last = (lastCorrect: boolean, dueDays: number) => ({ lastCorrect, dueAt: at(dueDays) })

  it('rappels : J+1 après erreur, puis J+3, J+7, J+14', () => {
    expect(nextReview(false, 2, t0)).toEqual({ box: 0, dueAt: at(1) })
    expect(nextReview(true, 0, t0)).toEqual({ box: 1, dueAt: at(3) })
    expect(nextReview(true, 1, t0)).toEqual({ box: 2, dueAt: at(7) })
    expect(nextReview(true, 2, t0)).toEqual({ box: 3, dueAt: at(14) })
    expect(nextReview(true, 3, t0)).toEqual({ box: 3, dueAt: at(14) })
  })
  it('étoiles et XP', () => {
    expect([1, 0.9, 0.6, 0.34, 0.2].map(starsFor)).toEqual([3, 3, 2, 1, 0])
    expect(scoreAnswers([true, true, false, true])).toEqual({ xp: 100 + 125 + 100, bestStreak: 2, correct: 3 })
    expect(levelOf(0)).toBe(1); expect(levelOf(300)).toBe(2)
  })
  it('états d’une notion de 3 questions', () => {
    expect(notionState([[], [], []], null, at(0))).toBe('a_decouvrir')
    expect(notionState([[win('s1', 0)], [], []], last(true, 3), at(0))).toBe('en_cours')
    // 3 réussites distinctes mais une seule séance : à consolider
    expect(notionState([[win('s1', 0)], [win('s1', 0)], [win('s1', 0)]], last(true, 3), at(0))).toBe('a_consolider')
    // 2 séances à moins de 24 h : à consolider
    expect(notionState([[win('s1', 0)], [win('s2', 0.5)], [win('s1', 0)]], last(true, 3), at(1))).toBe('a_consolider')
    // 3 questions distinctes, 2 séances à 24 h d'écart : consolidée
    expect(notionState([[win('s1', 0)], [win('s1', 0)], [win('s2', 1.1)]], last(true, 7), at(2))).toBe('consolidee')
  })
  it('une notion consolidée repasse « à réactiver » après une erreur ou un rappel très en retard', () => {
    const q3 = [[win('s1', 0)], [win('s1', 0)], [win('s2', 2)]]
    expect(notionState(q3, last(true, 7), at(3))).toBe('consolidee')
    expect(notionState(q3, last(false, 3), at(3))).toBe('a_reactiver')
    expect(notionState(q3, last(true, 5), at(20))).toBe('a_reactiver')
  })
  it('une réussite assistée ne compte pas', () => {
    expect(notionState([[{ ...win('s1', 0), unassisted: false }]], last(true, 3), at(0))).toBe('en_cours')
  })
  it('l’état d’une mission résume ses notions', () => {
    expect(missionStateOf(['a_decouvrir', 'a_decouvrir'])).toBe('a_decouvrir')
    expect(missionStateOf(['consolidee', 'consolidee'])).toBe('consolidee')
    expect(missionStateOf(['consolidee', 'a_consolider'])).toBe('a_consolider')
    expect(missionStateOf(['consolidee', 'en_cours'])).toBe('en_cours')
    expect(missionStateOf(['consolidee', 'a_reactiver', 'en_cours'])).toBe('a_reactiver')
  })

  it('une partie est limitée à 12 questions réparties régulièrement, dans l’ordre', () => {
    const qs = Array.from({ length: 30 }, (_, i) => i)
    const r = sampleRun(qs)
    expect(r).toHaveLength(12)
    expect(r[0]).toBe(0); expect(r[11]).toBe(29)
    expect([...r].sort((a, b) => a - b)).toEqual(r)
    expect(new Set(r).size).toBe(12)
    expect(sampleRun([1, 2, 3])).toEqual([1, 2, 3])
  })

  describe('révision : une question différente à chaque fois', () => {
    const mk = (id: string, notionId: string | null, level: number, position: number, missionId = 'm1') => ({ id, notionId, missionId, level, position })
    const qs = [mk('a1', 'N1', 1, 0), mk('a2', 'N1', 2, 1), mk('a3', 'N1', 3, 2), mk('b1', 'N2', 1, 3), mk('b2', 'N2', 2, 4)]
    const due = (k: string, ok = true, d = 0) => ({ notionKey: k, lastCorrect: ok, dueAt: at(d) })
    it('ne repose pas la dernière question posée', () => {
      const att = [{ questionId: 'a1', correct: true, at: at(0) }]
      expect(pickReview(qs, [due('N1')], att).map((q) => q.id)).not.toContain('a1')
    })
    it('préfère une question jamais vue puis la plus ancienne', () => {
      const att = [{ questionId: 'a1', correct: true, at: at(0) }, { questionId: 'a2', correct: true, at: at(1) }]
      expect(pickReview(qs, [due('N1')], att).map((q) => q.id)).toEqual(['a3'])
      const all = [...att, { questionId: 'a3', correct: true, at: at(2) }]
      expect(pickReview(qs, [due('N1')], all).map((q) => q.id)).toEqual(['a1'])                   // la plus ancienne ; a3 vient d'être posée
    })
    it('reprend en priorité une question ratée, notions ratées d’abord, du plus facile au plus difficile', () => {
      const att = [{ questionId: 'a1', correct: true, at: at(0) }, { questionId: 'a2', correct: false, at: at(1) }, { questionId: 'a3', correct: true, at: at(2) }]
      const r = pickReview(qs, [due('N1', true, 1), due('N2', false, 2)], att)
      expect(r.map((q) => q.id)).toEqual(['b1', 'a2'].sort((x, y) => (x === 'b1' ? 0 : 1) - (y === 'b1' ? 0 : 1)))   // b1 (niveau 1) avant a2 (niveau 2)
    })
    it('anciens cours : la mission sert de notion', () => {
      const legacy = [mk('x1', null, 1, 0, 'm2'), mk('x2', null, 1, 1, 'm2')]
      expect(notionKeyOf(legacy[0])).toBe('m:m2')
      expect(pickReview(legacy, [due('m:m2')], [{ questionId: 'x1', correct: true, at: at(0) }]).map((q) => q.id)).toEqual(['x2'])
    })
    it('limite le nombre de questions', () => {
      expect(pickReview(qs, [due('N1'), due('N2')], [], 1)).toHaveLength(1)
    })
  })
})
