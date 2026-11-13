import { FormEvent, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { adminToken, api, setAdminToken } from '../lib/api'
import { ErrorBox, Logo, Screen } from '../components/ui'
import { PasswordInput } from '../components/PasswordInput'

/** Connexion du backoffice : comptes administrateurs dédiés, distincts des enseignants et des étudiants. */
export default function AdminLogin() {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [logged, setLogged] = useState(!!adminToken())
  useEffect(() => { document.title = 'Backoffice — connexion' }, [])
  if (logged) return <Navigate to="/admin" replace />

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api('/admin/login', { auth: false, body: { email, password } }); setAdminToken(r.token); setLogged(true) }
    catch (err) { setError((err as Error).message); setBusy(false) }
  }
  return (
    <Screen>
      <div className="mb-8 mt-6 flex flex-col items-center gap-2 text-center">
        <Logo className="h-14" />
        <h1 className="text-2xl font-extrabold">Backoffice</h1>
        <p className="text-ink-soft">Accès réservé à l’équipe eUniversité.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4">
        <div><label htmlFor="email" className="label">Adresse e-mail</label><input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required autoFocus /></div>
        <div><label htmlFor="pw" className="label">Mot de passe</label><PasswordInput id="pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </Screen>
  )
}
