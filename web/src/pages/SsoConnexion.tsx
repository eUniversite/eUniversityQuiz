import { FormEvent, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, setStudentToken, studentToken } from '../lib/api'
import { ErrorBox, Logo, Screen, Spinner } from '../components/ui'
import { PasswordInput } from '../components/PasswordInput'
import { GoogleButton } from '../components/GoogleButton'

const KEYS = ['client_id', 'redirect_uri', 'state', 'nonce', 'code_challenge', 'code_challenge_method'] as const

/** Écran de connexion du SSO interne : une autre application eUniversité y envoie l'étudiant, qui revient avec un code à usage unique. */
export default function SsoConnexion() {
  const query = new URLSearchParams(location.search)
  const params = Object.fromEntries(KEYS.filter((k) => query.get(k)).map((k) => [k, query.get(k)!]))
  const [app, setApp] = useState<string | null>(null)
  const [logged, setLogged] = useState(!!studentToken())
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const sent = useRef(false)
  useEffect(() => { document.title = 'Connexion — eUniversité' }, [])

  useEffect(() => {
    if (query.get('response_type') !== 'code') return setError('Demande de connexion invalide.')
    api<{ name: string }>(`/sso/client?client_id=${encodeURIComponent(params.client_id ?? '')}&redirect_uri=${encodeURIComponent(params.redirect_uri ?? '')}`, { auth: false })
      .then((c) => setApp(c.name)).catch(() => setError('Cette application n’est pas autorisée à utiliser la connexion eUniversité.'))
  }, [])

  // Déjà connecté : on renvoie directement vers l'application.
  useEffect(() => {
    if (!logged || !app || sent.current) return
    sent.current = true
    api<{ redirectTo: string }>('/sso/authorize', { as: 'student', body: params })
      .then((r) => location.replace(r.redirectTo))
      .catch((e) => { sent.current = false; setError(e.message) })
  }, [logged, app])

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const r = await api('/session/login', { auth: false, body: { email, password } })
      if (r.role !== 'student') throw new Error('Ce service est réservé aux comptes étudiants.')
      setStudentToken(r.token); setLogged(true)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <Screen>
      <div className="mb-8 mt-6 flex flex-col items-center gap-2 text-center">
        <Logo className="h-14" />
        <h1 className="text-2xl font-extrabold">Connexion eUniversité</h1>
        {app && <p className="text-ink-soft">Pour continuer vers <strong>{app}</strong></p>}
      </div>
      {error && !app ? <ErrorBox>{error}</ErrorBox> : !app || logged ? (<>{error && <ErrorBox>{error}</ErrorBox>}<Spinner label="Redirection…" /></>) : (
        <form onSubmit={submit} className="card space-y-4">
          <GoogleButton text="signin_with" onDone={() => setLogged(true)} />
          <div><label htmlFor="email" className="label">Adresse e-mail</label><input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
          <div><label htmlFor="pw" className="label">Mot de passe</label><PasswordInput id="pw" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? 'Connexion…' : 'Continuer'}</button>
          <p className="border-t border-line pt-3 text-center text-base text-ink-soft">Pas de compte ? <Link className="font-bold text-ink underline" to="/etudiant/inscription">Créer mon compte</Link></p>
        </form>
      )}
    </Screen>
  )
}
