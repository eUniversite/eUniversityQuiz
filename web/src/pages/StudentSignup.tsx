import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, setStudentToken, signOut, studentToken } from '../lib/api'
import { isWeakPin } from '../lib/billing'
import { ErrorBox, Logo, Screen } from '../components/ui'
import { PinInput } from '../components/PinInput'
import { PlanPicker } from '../components/PlanPicker'

type Step = 'email' | 'pin' | 'confirm' | 'plan'
const STEPS: Step[] = ['email', 'pin', 'confirm', 'plan']
const TITLE: Record<Step, [string, string]> = {
  email: ['Votre e-mail', 'Il vous servira d’identifiant.'],
  pin: ['Créez votre PIN', '6 chiffres. Il remplace le mot de passe.'],
  confirm: ['Confirmez votre PIN', 'Saisissez-le une seconde fois.'],
  plan: ['Choisissez votre formule', 'Accès complet à Study, sans limite de cours.'],
}

/** Onboarding étudiant : e-mail → PIN → confirmation → formule d'abonnement → paiement GeniusPay. */
export default function StudentSignup() {
  const [step, setStep] = useState<Step>(studentToken() ? 'plan' : 'email') // compte déjà créé mais abonnement non payé
  const [email, setEmail] = useState(''); const [terms, setTerms] = useState(false)
  const [pin, setPin] = useState(''); const [again, setAgain] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'Créer mon compte — eUniversité' }, [])
  const at = STEPS.indexOf(step)
  const go = (s: Step) => { setError(''); setStep(s) }

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (step === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Saisissez une adresse e-mail valide.')
      if (!terms) return setError('Acceptez les conditions d’utilisation pour continuer.')
      return go('pin')
    }
    if (step === 'pin') {
      if (pin.length !== 6) return setError('Le PIN doit contenir 6 chiffres.')
      if (isWeakPin(pin)) return setError('Ce PIN est trop facile à deviner (111111, 123456…). Choisissez-en un autre.')
      return go('confirm')
    }
    if (step === 'confirm') {
      if (again !== pin) { setAgain(''); return setError('Les deux PIN ne sont pas identiques. Réessayez.') }
      setBusy(true)
      try {
        const r = await api('/student/signup', { auth: false, body: { email, pin, acceptedTerms: true } })
        setStudentToken(r.token); go('plan')
      } catch (err) {
        const fields = (err as ApiError).fields ?? []
        if (fields.some((f) => f.path === 'email')) { setStep('email'); setError((err as Error).message) }
        else if (fields.some((f) => f.path === 'pin')) { setPin(''); setAgain(''); setStep('pin'); setError(fields[0].message) }
        else setError((err as Error).message)
      } finally { setBusy(false) }
    }
  }

  const [title, hint] = TITLE[step]
  return (
    <Screen>
      <div className="mb-6 mt-4 flex items-center justify-between">
        {at > 0 && at < 3 ? <button className="btn-ghost btn-sm" onClick={() => go(STEPS[at - 1])}>← Retour</button> : <span className="w-[72px]" />}
        <Link to="/"><Logo className="h-10" /></Link>
        <span className="w-[72px]" />
      </div>

      <div className="mb-10 flex gap-2" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={at + 1} aria-label={`Étape ${at + 1} sur 4`}>
        {STEPS.map((s, i) => <span key={s} className={`h-1.5 flex-1 rounded-full transition ${i <= at ? 'bg-brand' : 'bg-line'}`} />)}
      </div>

      <div key={step} className="animate-rise">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold">{title}</h1>
          <p className="mt-2 text-lg text-ink-soft">{hint}</p>
        </div>

        {step === 'plan' ? <PlanPicker /> : (
          <form onSubmit={submit} className="space-y-6" noValidate>
            {step === 'email' && (
              <>
                <div>
                  <label htmlFor="email" className="sr-only">Adresse e-mail</label>
                  <input id="email" type="email" className="field min-h-[56px] text-lg" placeholder="vous@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" maxLength={200} autoFocus />
                </div>
                <div className="flex items-start gap-3">
                  <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
                  <label htmlFor="terms" className="text-base leading-snug">J’accepte les <Link to="/cgu" className="font-semibold underline">conditions d’utilisation</Link> et la <Link to="/confidentialite" className="font-semibold underline">politique de confidentialité</Link>.</label>
                </div>
              </>
            )}
            {step === 'pin' && <PinInput id="pin" value={pin} onChange={(v) => { setPin(v); setError('') }} label="PIN à 6 chiffres" invalid={!!error} autoFocus />}
            {step === 'confirm' && <PinInput id="pin2" value={again} onChange={(v) => { setAgain(v); setError('') }} label="Confirmation du PIN" invalid={!!error} autoFocus />}
            {error && <ErrorBox>{error}</ErrorBox>}
            <button className="btn-primary w-full text-lg" disabled={busy || (step === 'pin' && pin.length < 6) || (step === 'confirm' && again.length < 6)}>
              {busy ? 'Création du compte…' : step === 'confirm' ? 'Créer mon compte' : 'Continuer'}
            </button>
          </form>
        )}
      </div>

      {step === 'email' && <p className="mt-8 text-center text-base text-ink-soft">Déjà un compte ? <Link className="font-bold text-ink underline" to="/connexion">Se connecter</Link></p>}
      {step === 'plan' && <button className="mx-auto mt-6 block text-sm font-semibold text-ink-soft underline" onClick={() => { signOut(); window.location.assign('/connexion') }}>Utiliser un autre compte</button>}
    </Screen>
  )
}
