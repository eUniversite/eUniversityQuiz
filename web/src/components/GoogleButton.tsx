import { useEffect, useRef, useState } from 'react'
import { api, setStudentToken } from '../lib/api'
import { ErrorBox } from './ui'

declare global { interface Window { google?: { accounts: { id: { initialize: (o: unknown) => void; renderButton: (el: HTMLElement, o: unknown) => void } } } } }

let script: Promise<void> | null = null
const loadGsi = () => (script ??= new Promise<void>((ok, ko) => {
  const s = document.createElement('script')
  s.src = 'https://accounts.google.com/gsi/client'; s.async = true
  s.onload = () => ok(); s.onerror = () => { script = null; ko(new Error('Google indisponible')) }
  document.head.appendChild(s)
}))

/** « Continuer avec Google » : le jeton d'identité est vérifié par le serveur, qui crée ou retrouve le compte étudiant. N'affiche rien si Google n'est pas configuré. */
export function GoogleButton({ onDone, text = 'continue_with' }: { onDone: () => void; text?: 'signin_with' | 'signup_with' | 'continue_with' }) {
  const box = useRef<HTMLDivElement>(null)
  const [clientId, setClientId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const done = useRef(onDone); done.current = onDone

  useEffect(() => { api<{ googleClientId: string | null }>('/config', { auth: false }).then((c) => setClientId(c.googleClientId)).catch(() => {}) }, [])
  useEffect(() => {
    if (!clientId || !box.current) return
    let off = false
    loadGsi().then(() => {
      if (off || !box.current) return
      window.google!.accounts.id.initialize({
        client_id: clientId, ux_mode: 'popup', use_fedcm_for_prompt: true,
        callback: async (resp: { credential: string }) => {
          setError('')
          try { const r = await api('/auth/google', { auth: false, body: { credential: resp.credential } }); setStudentToken(r.token); done.current() }
          catch (e) { setError((e as Error).message) }
        },
      })
      window.google!.accounts.id.renderButton(box.current, { type: 'standard', theme: 'outline', size: 'large', text, shape: 'pill', locale: 'fr', width: Math.min(400, box.current.clientWidth || 320) })
    }).catch(() => setError('Impossible de charger Google. Utilisez votre e-mail.'))
    return () => { off = true }
  }, [clientId, text])

  if (!clientId) return null
  return (
    <div className="space-y-3">
      <div ref={box} className="flex min-h-[44px] justify-center" />
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="flex items-center gap-3 text-sm text-ink-soft" aria-hidden><span className="h-px flex-1 bg-line" />ou<span className="h-px flex-1 bg-line" /></div>
    </div>
  )
}
