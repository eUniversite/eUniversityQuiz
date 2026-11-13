import { FormEvent, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, setTeacherToken } from '../lib/api'
import { safeNext } from './Signup'
import { ErrorBox, Logo, Screen } from '../components/ui'
import { PasswordInput } from '../components/PasswordInput'

export default function Login() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const r = await api('/auth/login', { auth: false, body: { email, password } })
      setTeacherToken(r.token); nav(next, { replace: true })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Screen>
      <div className="mb-8 mt-6 flex flex-col items-center gap-2"><Logo className="h-14" /><h1 className="text-2xl font-extrabold">Espace professeur</h1></div>
      <form onSubmit={submit} className="card space-y-4">
        <div><label htmlFor="email" className="label">Adresse e-mail</label><input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
        <div><label htmlFor="pw" className="label">Mot de passe</label><PasswordInput id="pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-base">
          <Link className="font-semibold text-ink-soft underline" to="/enseignant/mot-de-passe-oublie">Mot de passe oublié ?</Link>
          <Link className="font-bold text-ink underline" to={`/enseignant/inscription?next=${encodeURIComponent(next)}`}>Créer un compte</Link>
        </div>
      </form>
    </Screen>
  )
}
