import { FormEvent, useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { api, currentRole, homeFor, setStudentToken, setTeacherToken } from '../lib/api'
import { ErrorBox, Logo, Screen } from '../components/ui'
import { GoogleButton } from '../components/GoogleButton'

/** Redirection post-connexion : on n'accepte qu'un chemin interne, et seulement s'il correspond au profil. */
const nextFor = (role: 'teacher' | 'student', raw: string | null) => {
  const ok = raw && raw.startsWith('/') && !raw.startsWith('//') && raw.startsWith(role === 'teacher' ? '/enseignant' : '/etudiant')
  return ok ? raw : homeFor(role)
}

/** Connexion unique : le serveur reconnaît le profil (enseignant ou étudiant) et on est envoyé au bon espace. */
export default function Connexion() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'Connexion — eUniversité' }, [])
  const role = currentRole()
  if (role) return <Navigate to={homeFor(role)} replace />

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try {
      const r = await api('/session/login', { auth: false, body: { email, password } })
      if (r.role === 'teacher') setTeacherToken(r.token); else setStudentToken(r.token)
      nav(nextFor(r.role, params.get('next')), { replace: true })
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <Screen>
      <div className="mb-8 mt-6 flex flex-col items-center gap-2 text-center">
        <Link to="/"><Logo className="h-14" /></Link>
        <h1 className="text-2xl font-extrabold">Connexion</h1>
        <p className="text-ink-soft">Enseignant ou étudiant : on vous envoie au bon espace.</p>
      </div>
      <form onSubmit={submit} className="card space-y-4">
        <GoogleButton text="signin_with" onDone={() => nav(nextFor('student', params.get('next')), { replace: true })} />
        <div><label htmlFor="email" className="label">Adresse e-mail</label><input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
        <div><label htmlFor="pw" className="label">Mot de passe</label><input id="pw" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {error && <ErrorBox>{error}</ErrorBox>}
        <button className="btn-primary w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-base">
          <Link className="font-semibold text-ink-soft underline" to="/enseignant/mot-de-passe-oublie">Mot de passe oublié ?</Link>
        </div>
        <p className="border-t border-line pt-3 text-center text-base text-ink-soft">
          Pas encore de compte ? <Link className="font-bold text-ink underline" to="/etudiant/inscription">Je suis étudiant</Link> · <Link className="font-bold text-ink underline" to="/enseignant/inscription">Je suis enseignant</Link>
        </p>
      </form>
    </Screen>
  )
}
