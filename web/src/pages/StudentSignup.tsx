import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, ApiError, currentRole, homeFor, setStudentToken } from '../lib/api'
import { ErrorBox, Logo, Screen } from '../components/ui'
import { GoogleButton } from '../components/GoogleButton'
import { PasswordInput } from '../components/PasswordInput'

/** Inscription étudiante : un seul écran, aucun paiement. Le compte démarre en plan Découverte et on arrive directement dans Study. */
export default function StudentSignup() {
  const nav = useNavigate()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [terms, setTerms] = useState(false)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'Créer mon compte — eUniversité' }, [])
  const role = currentRole()
  if (role) return <Navigate to={homeFor(role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault(); setError('')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Saisissez une adresse e-mail valide.')
    if (password.length < 8) return setError('Le mot de passe doit contenir au moins 8 caractères.')
    if (!terms) return setError('Acceptez les conditions d’utilisation pour continuer.')
    setBusy(true)
    try {
      const r = await api('/student/signup', { auth: false, body: { email, password, acceptedTerms: true } })
      setStudentToken(r.token); nav('/etudiant', { replace: true })
    } catch (err) { setError((err as ApiError).fields?.[0]?.message ?? (err as Error).message); setBusy(false) }
  }

  return (
    <Screen>
      <div className="mb-8 mt-4 flex flex-col items-center gap-2 text-center">
        <Link to="/"><Logo className="h-12" /></Link>
        <h1 className="text-3xl font-extrabold">Créer mon compte</h1>
        <p className="text-lg text-ink-soft">Gratuit, sans carte bancaire.</p>
      </div>

      <div className="space-y-5">
        <GoogleButton text="signup_with" onDone={() => nav('/etudiant', { replace: true })} />
        <form onSubmit={submit} className="space-y-5" noValidate>
          <div>
            <label htmlFor="email" className="label">Adresse e-mail</label>
            <input id="email" type="email" className="field min-h-[52px] text-lg" placeholder="vous@exemple.com" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" inputMode="email" maxLength={200} />
          </div>
          <div>
            <label htmlFor="pw" className="label">Mot de passe</label>
            <PasswordInput id="pw" className="min-h-[52px] text-lg" placeholder="8 caractères minimum" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={200} />
          </div>
          <div className="flex items-start gap-3">
            <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
            <label htmlFor="terms" className="text-base leading-snug">J’accepte les <Link to="/cgu" className="font-semibold underline">conditions d’utilisation</Link> et la <Link to="/confidentialite" className="font-semibold underline">politique de confidentialité</Link>.</label>
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button className="btn-primary w-full text-lg" disabled={busy}>{busy ? 'Création du compte…' : 'Créer mon compte'}</button>
        </form>
      </div>

      <p className="mt-8 text-center text-base text-ink-soft">Déjà un compte ? <Link className="font-bold text-ink underline" to="/connexion">Se connecter</Link></p>
    </Screen>
  )
}
