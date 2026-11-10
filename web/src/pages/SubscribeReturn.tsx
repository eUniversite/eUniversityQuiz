import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { fmtDay, type Subscription } from '../lib/billing'
import { Logo, Screen, Spinner } from '../components/ui'

interface Paid { status: 'PENDING' | 'COMPLETED' | 'FAILED'; subscription: Subscription }
const POLL_MS = 3000, GIVE_UP_MS = 4 * 60_000

/** Retour de GeniusPay : on attend la confirmation (webhook, sinon vérification auprès de GeniusPay), puis on ouvre Study. */
export default function SubscribeReturn() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const id = params.get('payment'), cancelled = params.get('status') === 'cancelled'
  const [paid, setPaid] = useState<Paid | null>(null)
  const [lost, setLost] = useState(false)
  const [missing, setMissing] = useState(false)
  const started = useRef(Date.now())
  useEffect(() => { document.title = 'Paiement — eUniversité' }, [])

  useEffect(() => {
    if (!id) return
    let stop = false, timer: number
    const tick = async () => {
      try {
        const r = await api<Paid>(`/billing/payments/${id}`, { as: 'student' })
        if (stop) return
        setPaid(r)
        if (r.status !== 'PENDING') return
      } catch (e) {
        if ((e as ApiError).status === 404) return setMissing(true)
        /* réseau instable : on réessaie */
      }
      if (Date.now() - started.current > GIVE_UP_MS) return setLost(true)
      timer = window.setTimeout(tick, POLL_MS)
    }
    tick()
    return () => { stop = true; window.clearTimeout(timer) }
  }, [id])

  useEffect(() => {
    if (paid?.status !== 'COMPLETED') return
    const t = window.setTimeout(() => nav('/etudiant', { replace: true }), 3500)
    return () => window.clearTimeout(t)
  }, [paid, nav])

  const failed = paid?.status === 'FAILED' || (cancelled && paid?.status === 'PENDING')
  return (
    <Screen>
      <div className="mb-10 mt-4 flex justify-center"><Link to="/etudiant"><Logo className="h-10" /></Link></div>
      <div className="card animate-rise py-10 text-center">
        {!id || missing ? (
          <>
            <h1 className="text-2xl font-extrabold">Paiement introuvable</h1>
            <Link to="/etudiant/abonnement" className="btn-primary mt-8 w-full">Choisir une formule</Link>
          </>
        ) : paid?.status === 'COMPLETED' ? (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-ok/15 text-3xl text-ok" aria-hidden>✓</div>
            <h1 className="text-2xl font-extrabold">Abonnement activé</h1>
            {paid.subscription.endsAt && <p className="mt-2 text-lg text-ink-soft">jusqu’au {fmtDay(paid.subscription.endsAt)}</p>}
            <Link to="/etudiant" className="btn-primary mt-8 w-full text-lg">Commencer</Link>
          </>
        ) : failed ? (
          <>
            <h1 className="text-2xl font-extrabold">Paiement non abouti</h1>
            <p className="mt-2 text-lg text-ink-soft">Aucun montant n’a été débité par eUniversité.</p>
            <Link to="/etudiant/abonnement" className="btn-primary mt-8 w-full text-lg">Réessayer</Link>
          </>
        ) : lost ? (
          <>
            <h1 className="text-2xl font-extrabold">Toujours en attente</h1>
            <p className="mt-2 text-lg text-ink-soft">Si vous avez payé, l’accès s’ouvrira dans quelques minutes.</p>
            <button className="btn-primary mt-8 w-full text-lg" onClick={() => location.reload()}>Vérifier à nouveau</button>
          </>
        ) : (
          <>
            <Spinner label="Confirmation du paiement…" />
            <p className="px-4 text-base text-ink-soft">Gardez cette page ouverte, cela prend quelques secondes.</p>
          </>
        )}
      </div>
    </Screen>
  )
}
