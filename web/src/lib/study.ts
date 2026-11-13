export interface Quest { key: string; label: string; goal: number; value: number }
export interface Stats {
  totalXp: number; level: number; levelXp: number; levelSize: number; streakDays: number; sessions: number; due: number
  dueCourses: { courseId: string; title: string; due: number }[]; quests: Quest[]
}
export type NotionState = 'a_decouvrir' | 'en_cours' | 'a_consolider' | 'consolidee' | 'a_reactiver'
export interface NotionProgress { id: string; label: string; questions: number; state: NotionState; due: boolean }
export interface MissionProgress { id: string; title: string; questions: number; notions: NotionProgress[]; state: NotionState; stars: number; plays: number; locked: boolean; planLocked?: boolean; due: number }
export interface CourseProgress { plan?: 'free' | 'paid'; missions: MissionProgress[]; due: number; notions: number; mastered: number }
export const STATE_LABEL: Record<NotionState, string> = {
  a_decouvrir: 'À découvrir', en_cours: 'En cours', a_consolider: 'À consolider', consolidee: 'Consolidée', a_reactiver: 'À réactiver',
}
export const STATE_HINT: Record<NotionState, string> = {
  a_decouvrir: 'Pas encore jouée.',
  en_cours: 'Continue : réponds juste à plusieurs questions différentes.',
  a_consolider: 'Reviens jouer demain pour la consolider (2 séances à 24 h d’écart).',
  consolidee: 'Bien retenue ! Un rappel te sera proposé plus tard.',
  a_reactiver: 'Un rappel est dû : une révision rapide la remettra d’aplomb.',
}
