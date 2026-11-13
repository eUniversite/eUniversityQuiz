import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { DEFAULT_PLANS, fcfa, type PlanId, type PlanInfo } from '../lib/billing'
import { ErrorBox } from './ui'

/** Choix de la formule puis paiement : le navigateur envoie seulement le nom de la formule, le montant vient du serveur. */
export function PlanPicker({ cta = 'Payer' }: { cta?: string }) {
  const [plans, setPlans] = useState<PlanInfo[]>(DEFAULT_PLANS)
  const [plan, setPlan] = useState<PlanId>('YEARLY')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api<PlanInfo[]>('/billing/plans', { auth: false }).then(setPlans).catch(() => {}) }, [])

  const monthly = plans.find((p) => p.plan === 'MONTHLY') ?? DEFAULT_PLANS[0]
  const yearly = plans.find((p) => p.plan === 'YEARLY') ?? DEFAULT_PLANS[1]
  const chosen = plan === 'YEARLY' ? yearly : monthly

  async function pay() {
    setBusy(true); setError('')
    try {
      const r = await api<{ checkoutUrl: string }>('/billing/checkout', { as: 'student', body: { plan } })
      window.location.href = r.checkoutUrl // chez GeniusPay (ou page de retour directe en mode démo)
    } catch (e) { setError((e as Error).message); setBusy(false) }
  }

  const card = (p: PlanInfo, sub: string) => {
    const on = plan === p.plan
    return (
      <button key={p.plan} type="button" role="radio" aria-checked={on} onClick={() => setPlan(p.plan)}
        className={`w-full rounded-2xl border-2 p-5 text-left transition ${on ? 'border-brand bg-brand-soft' : 'border-line bg-card hover:border-ink/30'}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-lg font-extrabold">{p.label}</div>
            <div className="text-base text-ink-soft">{sub}</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-extrabold">{fcfa(p.amount)}</div>
            <div className="text-base text-ink-soft">{p.plan === 'YEARLY' ? 'par an' : 'par mois'}</div>
          </div>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="Formule d’abonnement" className="space-y-5">
        {card(monthly, 'sans engagement')}
        {card(yearly, `soit ${fcfa(Math.round(yearly.amount / 12))} par mois`)}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <button className="btn-primary w-full text-lg" onClick={pay} disabled={busy}>{busy ? 'Redirection vers le paiement…' : `${cta} ${fcfa(chosen.amount)}`}</button>
      <p className="text-center text-sm text-ink-soft">Paiement sécurisé GeniusPay · Mobile Money et carte</p>
    </div>
  )
}
