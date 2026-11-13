import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, signOut } from '../lib/api'
import { fmtDay, type Subscription } from '../lib/billing'
import { ErrorBox, Logo, Screen, Spinner } from '../components/ui'
import { PlanPicker } from '../components/PlanPicker'

/** Abonnement de l'étudiant : choisir une formule (compte sans abonnement) ou prolonger l'accès. */
export default function Subscribe() {
  const nav = useNavigate()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    document.title = 'Abonnement — eUniversité'
    api<{ subscription: Subscription }>('/student/me', { as: 'student' }).then((m) => setSub(m.subscription)).catch((e) => setError(e.message))
  }, [])

  return (
    <Screen>
      <header className="mb-10 mt-4 flex items-center justify-between">
        <Link to="/etudiant"><Logo className="h-10" /></Link>
        <button className="btn-ghost btn-sm" onClick={() => { signOut(); nav('/') }}>Déconnexion</button>
      </header>
      {error ? <ErrorBox>{error}</ErrorBox> : !sub ? <Spinner /> : (
        <div className="animate-rise space-y-8">
          {sub.active ? (
            <>
              <div className="card text-center">
                <p className="text-lg font-bold">Abonnement actif</p>
                <p className="mt-1 text-lg text-ink-soft">jusqu’au {fmtDay(sub.endsAt!)}</p>
                <Link to="/etudiant" className="btn-primary mt-6 w-full text-lg">Retour à Study</Link>
              </div>
              <div>
                <h2 className="mb-6 text-center text-xl font-extrabold">Prolonger mon accès</h2>
                <PlanPicker cta="Prolonger —" />
              </div>
            </>
          ) : (
            <>
              <div className="text-center">
                <h1 className="text-3xl font-extrabold">Tout débloquer</h1>
                <p className="mt-2 text-lg text-ink-soft">Toutes les missions, des cours illimités et des fichiers jusqu’à 10 Mo.</p>
              </div>
              <PlanPicker />
              <Link to="/etudiant" className="mx-auto block text-center text-base font-semibold text-ink-soft underline">Plus tard, continuer en plan Découverte</Link>
            </>
          )}
        </div>
      )}
    </Screen>
  )
}
