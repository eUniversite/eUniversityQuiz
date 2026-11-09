import { DragEvent, FormEvent, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { uploadCourse } from '../lib/api'
import { ErrorBox, Logo } from '../components/ui'

const MAX_MB = 10
const OK = /\.(pdf|docx|txt|md)$/i

/** Étape 1 de Study : déposer un cours. La suite (analyse, création, jeu) se suit sur /etudiant/study/:id. */
export default function StudyNew() {
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [over, setOver] = useState(false)
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'Importer un cours — eUniversité Study' }, [])

  function pick(f: File | undefined | null) {
    setError('')
    if (!f) return
    if (!OK.test(f.name)) return setError('Format non pris en charge. Importez un PDF, un DOCX, un TXT ou un MD.')
    if (f.size > MAX_MB * 1024 * 1024) return setError(`Fichier trop volumineux (${MAX_MB} Mo maximum).`)
    setFile(f)
  }
  const drop = (e: DragEvent) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files[0]) }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!file) return setError('Choisissez un fichier à importer.')
    setBusy(true); setError('')
    try { const r = await uploadCourse(file); nav(`/etudiant/study/${r.id}${r.truncated ? '?tronque=1' : ''}`) }
    catch (err) { setError((err as Error).message); setBusy(false) }
  }

  return (
    <div className="mx-auto min-h-dvh max-w-2xl px-4 py-6">
      <header className="flex items-center justify-between"><Link to="/etudiant"><Logo className="h-10" /></Link>
        <Link to="/etudiant" className="text-base font-semibold text-ink-soft underline-offset-4 hover:underline">Retour</Link></header>
      <main className="mt-8 space-y-5">
        <div><h1 className="text-3xl font-extrabold">Importer un cours</h1>
          <p className="mt-2 text-lg text-ink-soft">Déposez votre cours : on l’analyse, on crée les questions, puis vous jouez.</p></div>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div role="button" tabIndex={0} aria-label="Choisir un fichier" onClick={() => input.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.current?.click())}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)} onDrop={drop}
            className={`card flex min-h-[200px] cursor-pointer flex-col items-center justify-center gap-2 border-2 border-dashed text-center transition ${over ? 'border-brand bg-brand-soft' : 'border-line hover:border-brand'}`}>
            {file ? (
              <><p className="text-xl font-extrabold break-all">{file.name}</p><p className="text-ink-soft">{(file.size / 1024 / 1024).toFixed(2)} Mo · cliquez pour changer</p></>
            ) : (
              <><p className="text-xl font-extrabold">Déposez votre cours ici</p><p className="text-ink-soft">ou cliquez pour choisir un fichier</p>
                <p className="text-sm text-ink-soft">PDF, DOCX, TXT ou MD · {MAX_MB} Mo maximum</p></>
            )}
            <input ref={input} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <button className="btn-primary min-h-[56px] w-full text-lg" disabled={busy || !file}>{busy ? 'Envoi…' : 'Créer mon parcours'}</button>
          <p className="text-center text-sm text-ink-soft">Votre fichier n’est pas conservé : seuls les questions créées le sont. Le texte est envoyé au service de génération.</p>
        </form>
      </main>
    </div>
  )
}
