export type PlanId = 'MONTHLY' | 'YEARLY'
export interface PlanInfo { plan: PlanId; label: string; amount: number; months: number; currency: string }
export interface Subscription { active: boolean; plan: PlanId | null; endsAt: string | null }
/** Droits du compte : plan Découverte (free) ou abonné (paid). `null` = illimité. */
export interface Limits { plan: 'free' | 'paid'; uploadMb: number; courses: number | null; missions: number | null }

/** Tarifs affichés en attendant la réponse du serveur (qui reste seul juge du montant facturé). */
export const DEFAULT_PLANS: PlanInfo[] = [
  { plan: 'MONTHLY', label: 'Mensuel', amount: 1000, months: 1, currency: 'XOF' },
  { plan: 'YEARLY', label: 'Annuel', amount: 10000, months: 12, currency: 'XOF' },
]

export const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
