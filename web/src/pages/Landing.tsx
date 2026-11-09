import { FormEvent, useEffect, useState, type CSSProperties } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { api, currentRole, homeFor } from '../lib/api'
import { cleanCode } from '../lib/student'
import { Logo } from '../components/ui'

/** Split Text : découpe un texte en mots (masques) puis en lettres qui montent en cascade. `from` = rang de la première lettre. */
function Split({ text, from = 0 }: { text: string; from?: number }) {
  let i = from
  return (
    <>
      {text.split(/(?<=\s)/).map((word, w) => (
        <span key={w} className="lp-word" aria-hidden>
          {[...word].map((ch, k) => <span key={k} className="lp-char" style={{ '--i': i++ } as CSSProperties}>{ch}</span>)}
        </span>
      ))}
    </>
  )
}

/** Accueil commun : titre, deux services côte à côte, chacun avec son bouton « Commencer ». */
export default function Landing() {
  const nav = useNavigate()
  const [codeOpen, setCodeOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { document.title = 'eUniversité — Enseigner, apprendre, jouer' }, [])

  // Redirection intelligente : un profil déjà connecté arrive directement dans son espace.
  const role = currentRole()
  if (role) return <Navigate to={homeFor(role)} replace />

  async function join(e: FormEvent) {
    e.preventDefault()
    const c = cleanCode(code)
    if (c.length < 4) return setError('Saisis le code affiché au tableau (4 caractères minimum).')
    setBusy(true); setError('')
    try {
      const s = await api(`/public/sessions/${c}`, { auth: false })
      if (s.ended) return setError('Cette session est terminée.')
      nav(`/j/${c}`)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-paper px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-10 lg:px-16">
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div className="absolute -right-40 -top-40 h-[34rem] w-[34rem] rounded-full bg-brand/15 blur-3xl" />
        <div className="absolute -bottom-56 -left-40 h-[30rem] w-[30rem] rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute inset-0 [background-image:radial-gradient(rgb(var(--ink)/.06)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_bottom_right,black,transparent_55%)]" />
      </div>

      <header className="relative flex items-center justify-between lp-fade"><Logo className="h-10 sm:h-12" />
        <Link to="/connexion" className="min-h-[44px] px-2 py-2 text-base font-semibold text-ink-soft underline-offset-4 hover:text-ink hover:underline">Se connecter</Link>
      </header>

      <main className="relative flex-1 w-full max-w-5xl py-8 mx-auto lg:py-12">
        {/* Titre */}
        <section>
          <h1 aria-label="Enseigner en direct. Apprendre en jouant." className="w-full text-center font-extrabold leading-[1.15] tracking-tight text-ink text-[clamp(1.6rem,7.2vw,3.75rem)]">
            <span className="block whitespace-nowrap"><Split text="Enseigner en direct." /></span>
            <span className="block whitespace-nowrap"><span className="lp-underline" style={{ animationDelay: '1.7s' }}><Split text="Apprendre en jouant." from={20} /></span></span>
          </h1>
        </section>

        {/* Les deux profils, côte à côte, alignés */}
        <section className="grid gap-6 mt-10 lg:mt-14 lg:grid-cols-2 lg:gap-8" aria-label="Les deux profils">
          <article className="flex flex-col gap-5 card lp-card" style={{ '--d': '.7s' } as CSSProperties}>
            <StudyPreview />
            <div>
              <p className="text-sm font-bold tracking-wider uppercase text-brand-dark">Étudiant</p>
              <h2 className="mt-1 text-3xl font-extrabold">Study</h2>
              <p className="mt-2 text-lg leading-relaxed text-ink-soft">
                Importez un cours et jouez-le comme un jeu de course : chaque bonne réponse ouvre la porte suivante. Votre progression est gardée pour réviser au bon moment.
              </p>
            </div>
            <Link to="/etudiant/inscription" className="btn-primary mt-auto min-h-[56px] text-lg">Commencer</Link>
          </article>
          <article className="flex flex-col gap-5 card lp-card" style={{ '--d': '.95s' } as CSSProperties}>
            <LivePreview />
            <div>
              <p className="text-sm font-bold tracking-wider uppercase text-brand-dark">Enseignant</p>
              <h2 className="mt-1 text-3xl font-extrabold">Live</h2>
              <p className="mt-2 text-lg leading-relaxed text-ink-soft">
                Créez un quiz, partagez le code et laissez toute la classe répondre en direct sur téléphone, avec classement en temps réel et correction expliquée.
              </p>
            </div>
            <Link to="/enseignant/inscription" className="btn-primary mt-auto min-h-[56px] text-lg">Commencer</Link>
          </article>
        </section>

        {/* Rejoindre une session en classe sans compte */}
        <section className="flex flex-col items-center gap-3 mt-10 text-center lp-fade lg:mt-14" style={{ '--d': '1.4s' } as CSSProperties}>
          {!codeOpen ? (
            <button type="button" className="text-base font-semibold underline text-ink-soft underline-offset-4 hover:text-ink" onClick={() => setCodeOpen(true)}>J’ai un code de session</button>
          ) : (
            <form onSubmit={join} noValidate className="w-full max-w-sm animate-rise" onKeyDown={(e) => e.key === 'Escape' && setCodeOpen(false)}>
              <label htmlFor="session-code" className="label">Code de session</label>
              <div className="flex gap-2">
                <input id="session-code" autoFocus className={`field min-h-[52px] flex-1 text-center text-2xl font-extrabold uppercase tracking-[.25em] ${error ? 'field-error' : ''}`}
                  value={code} maxLength={8} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} enterKeyHint="go" placeholder="ABC123"
                  aria-invalid={!!error} aria-describedby={error ? 'session-error' : undefined}
                  onChange={(e) => { setCode(cleanCode(e.target.value)); setError('') }} />
                <button className="btn-dark min-h-[52px] px-5" disabled={busy}>{busy ? '…' : 'Rejoindre'}</button>
              </div>
              {error && <p id="session-error" role="alert" className="mt-2 text-base font-semibold text-bad">{error}</p>}
            </form>
          )}
        </section>
      </main>

      <footer className="relative w-full max-w-5xl pt-4 mx-auto text-sm leading-relaxed text-center border-t border-line text-ink-soft lg:text-left">
        <p className="font-semibold text-ink">Une solution eUniversité — Votre Campus Connecté</p>
        <p>GENIUS GROUPS SAS · Section EduTech</p>
      </footer>
    </div>
  )
}

/** Aperçu d'une question de quiz en HTML/CSS : purement décoratif. */
function LivePreview() {
  return (
    <div className="relative w-full max-w-sm mx-auto" role="img" aria-label="Aperçu d’une question de quiz avec trois réponses">
      <div aria-hidden className="lp-layer-back absolute inset-0 rounded-[2rem] border border-line bg-brand-soft/70" style={{ '--r': '-3deg' } as CSSProperties} />
      <div className="lp-layer-front relative space-y-3 rounded-[2rem] border border-line bg-card p-5 shadow-[0_24px_60px_-20px_rgba(38,38,43,.35)]" aria-hidden style={{ '--r2': '1deg' } as CSSProperties}>
        <div className="h-2.5 overflow-hidden rounded-full bg-line"><div className="w-full h-full rounded-full lp-progress bg-brand" /></div>
        <div className="space-y-2"><div className="h-3.5 w-11/12 rounded-full bg-ink/80" /><div className="h-3.5 w-6/12 rounded-full bg-ink/80" /></div>
        {(['A', 'B', 'C'] as const).map((l, i) => (
          <div key={l} className="lp-pick flex items-center gap-3 rounded-2xl border-2 border-line bg-card px-3 py-2.5" style={{ '--k': i } as CSSProperties}>
            <span className={`grid h-8 w-8 place-items-center rounded-xl font-extrabold ${i === 0 ? 'bg-brand text-ink' : 'bg-paper text-ink-soft'}`}>{l}</span>
            <div className="flex-1 h-3 rounded-full bg-line" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Aperçu de Study sans personnage : la question et les trois portes-réponses, en HTML/CSS décoratif. */
function StudyPreview() {
  return (
    <div className="relative w-full max-w-sm mx-auto" role="img" aria-label="Aperçu de Study : une question et trois portes à choisir">
      <div aria-hidden className="lp-layer-back absolute inset-0 rounded-[2rem] border border-line bg-brand-soft/70" style={{ '--r': '2deg' } as CSSProperties} />
      <div className="lp-layer-front relative rounded-[2rem] border border-line bg-card p-5 shadow-[0_24px_60px_-20px_rgba(38,38,43,.35)]" aria-hidden style={{ '--r2': '-1deg' } as CSSProperties}>
        <div className="mb-4 space-y-2"><div className="h-3.5 w-10/12 rounded-full bg-ink/80" /><div className="h-3.5 w-5/12 rounded-full bg-ink/80" /></div>
        <div className="grid items-end grid-cols-3 gap-3">
          {(['A', 'B', 'C'] as const).map((l, i) => (
            <div key={l} className={`flex flex-col items-center ${i === 1 ? 'lp-door-open' : 'lp-door'}`} style={{ '--k': i } as CSSProperties}>
              <div className={`grid w-full place-items-center rounded-t-2xl border-2 border-ink text-3xl font-extrabold text-ink ${i === 1 ? 'h-28 bg-brand' : 'h-24 bg-brand/80'}`}>{l}</div>
              <div className="w-full h-2 rounded-b bg-ink/70" />
            </div>
          ))}
        </div>
        <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-line"><div className="w-full h-full rounded-full lp-progress bg-brand" /></div>
      </div>
    </div>
  )
}
