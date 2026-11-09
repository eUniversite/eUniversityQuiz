import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, setStudentToken } from '../lib/api'
import { ErrorBox, Logo, Screen } from '../components/ui'
import { PwToggle } from './Signup'

export default function StudentSignup() {
  const nav = useNavigate()
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [show, setShow] = useState(false); const [terms, setTerms] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'Créer mon compte étudiant — eUniversité' }, [])

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setErrors({})
    try {
      const r = await api('/student/signup', { auth: false, body: { name, email, password, acceptedTerms: terms } })
      setStudentToken(r.token); nav('/etudiant', { replace: true })
    } catch (err) {
      const fields = (err as ApiError).fields ?? []
      if (fields.length) setErrors(Object.fromEntries(fields.map((f) => [f.path, f.message])))
      else setError((err as Error).message)
    } finally { setBusy(false) }
  }
  const err = (k: string) => errors[k] && <p className="mt-1.5 text-sm font-semibold text-bad">{errors[k]}</p>

  return (
    <Screen>
      <div className="mb-8 mt-4 flex flex-col items-center gap-3 text-center animate-rise">
        <Link to="/"><Logo className="h-12" /></Link>
        <h1 className="text-3xl font-extrabold">Apprenez en jouant.</h1>
        <p className="text-lg text-ink-soft">Créez votre compte étudiant pour garder votre progression.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4 animate-rise" noValidate>
        <div><label htmlFor="name" className="label">Nom complet</label>
          <input id="name" className={`field min-h-[52px] ${errors.name ? 'field-error' : ''}`} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={100} />{err('name')}</div>
        <div><label htmlFor="email" className="label">Adresse e-mail</label>
          <input id="email" type="email" className={`field min-h-[52px] ${errors.email ? 'field-error' : ''}`} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={200} inputMode="email" />{err('email')}</div>
        <div><label htmlFor="password" className="label">Mot de passe</label>
          <div className="relative">
            <input id="password" type={show ? 'text' : 'password'} className={`field min-h-[52px] pr-24 ${errors.password ? 'field-error' : ''}`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={200} />
            <PwToggle show={show} onClick={() => setShow(!show)} />
          </div>
          {err('password') ?? <p className="mt-1.5 text-sm text-ink-soft">8 caractères minimum.</p>}</div>
        <div className="flex items-start gap-3">
          <input id="terms" type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--brand))]" />
          <label htmlFor="terms" className="text-base leading-snug">J’accepte les <Link to="/cgu" className="font-semibold underline">conditions d’utilisation</Link> et j’ai lu la <Link to="/confidentialite" className="font-semibold underline">politique de confidentialité</Link>.</label>
        </div>
        {err('acceptedTerms')}
        {error && <ErrorBox>{error}</ErrorBox>}
        <button className="btn-primary w-full text-lg" disabled={busy}>{busy ? 'Création…' : 'Créer mon compte'}</button>
        <p className="text-center text-base text-ink-soft">Déjà un compte ? <Link className="font-bold text-ink underline" to="/connexion">Se connecter</Link></p>
      </form>
    </Screen>
  )
}
