export type PlanId = 'MONTHLY' | 'YEARLY'
export interface PlanInfo { plan: PlanId; label: string; amount: number; months: number; currency: string }
export interface Subscription { active: boolean; plan: PlanId | null; endsAt: string | null }

/** Tarifs affichés en attendant la réponse du serveur (qui reste seul juge du montant facturé). */
export const DEFAULT_PLANS: PlanInfo[] = [
  { plan: 'MONTHLY', label: 'Mensuel', amount: 1000, months: 1, currency: 'XOF' },
  { plan: 'YEARLY', label: 'Annuel', amount: 10000, months: 12, currency: 'XOF' },
]

export const fcfa = (n: number) => `${n.toLocaleString('fr-FR')} FCFA`
export const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

/** Même règle que le serveur : on écarte 000000, 123456, 654321, 121212, 123123… */
export function isWeakPin(pin: string) {
  if (/^(\d)\1+$/.test(pin)) return true
  const d = [...pin].map(Number), step = d[1] - d[0]
  if ((step === 1 || step === -1) && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return true
  return /^(\d{2})\1\1$/.test(pin) || /^(\d{3})\1$/.test(pin)
}
