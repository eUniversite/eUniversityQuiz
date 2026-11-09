import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { ErrorBox, Logo, Spinner } from '../components/ui'
import { WorldMap } from '../components/WorldMap'

interface Course {
  id: string; fileName: string; title: string | null; status: 'QUEUED' | 'EXTRACTING' | 'ANALYSING' | 'CREATING' | 'READY' | 'FAILED'; error: string | null; progress: number; step: string | null
  summary: string | null; missions: { title: string; notions: number }[]; questionCount: number
}

const STEPS = [
  { key: 'import', label: 'Import', hint: 'Votre cours est reçu.' },
  { key: 'analyse', label: 'Analyse', hint: 'On lit le cours et on repère les chapitres et notions clés.' },
  { key: 'creation', label: 'Création', hint: 'On écrit les questions, chacune liée à un passage du cours.' },
  { key: 'jeu', label: 'Jeu prêt', hint: 'Votre parcours est prêt.' },
] as const

/** Étape courante (0-3) d'après le statut serveur. */
const stepOf = (s: Course['status']) => (s === 'READY' ? 4 : s === 'CREATING' ? 2 : s === 'ANALYSING' ? 1 : 0)

/** Suivi du parcours : import → analyse → création → jeu. « Commencer » ouvre le jeu 3D sur ce cours. */
export default function StudyCourse() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [c, setC] = useState<Course | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { document.title = 'Mon parcours — eUniversité Study' }, [])

  useEffect(() => {
    let stop = false
    let timer: number
    const tick = async () => {
      try {
        const d: Course = await api(`/study/courses/${id}`, { as: 'student' })
        if (stop) return
        setC(d)
        if (d.status !== 'READY' && d.status !== 'FAILED') timer = window.setTimeout(tick, 1500)
      } catch (e) { if (!stop) setError((e as Error).message) }
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [id])

  const step = c ? stepOf(c.status) : 0
  const failed = c?.status === 'FAILED'

  return (
    <div className="gm mx-auto min-h-dvh max-w-xl px-6 py-8">
      <header className="flex items-center justify-between"><Link to="/etudiant"><Logo className="h-10" /></Link>
        <Link to="/etudiant" className="text-base font-semibold text-ink-soft underline-offset-4 hover:underline">Mon espace</Link></header>
      <main className="mt-10 space-y-8">
        {error ? <ErrorBox>{error}</ErrorBox> : !c ? <Spinner /> : (
          <>
            <div><h1 className="text-3xl font-extrabold">{c.title ?? 'Création de votre parcours'}</h1>
              {c.status !== 'READY' && <p className="mt-1 break-all text-ink-soft">{c.fileName}</p>}</div>

            {c.status === 'READY' ? <WorldMap courseId={c.id} /> : <>

            <ol className="card space-y-1" aria-label="Avancement">
              {STEPS.map((s, i) => {
                const done = i < step, current = i === step && !failed
                return (
                  <li key={s.key} className="flex items-start gap-3 py-2" aria-current={current ? 'step' : undefined}>
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 font-extrabold ${done ? 'border-ok bg-ok text-white' : current ? 'border-brand bg-brand-soft text-ink' : failed && i === step ? 'border-bad text-bad' : 'border-line text-ink-soft'}`}>
                      {done ? '✓' : failed && i === step ? '!' : i + 1}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-lg font-bold ${done || current ? 'text-ink' : 'text-ink-soft'}`}>{s.label}{current && <span className="ml-2 inline-block animate-breathe text-brand">●</span>}</p>
                      {(current || (done && i === step - 1)) && <p className="text-base text-ink-soft">{s.hint}</p>}
                    </div>
                  </li>
                )
              })}
            </ol>

            {!failed && (
              <div role="progressbar" aria-valuenow={c.progress} aria-valuemin={0} aria-valuemax={100} aria-label="Avancement de la création">
                <div className="h-3 overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-brand transition-all duration-700" style={{ width: `${Math.max(c.progress, 4)}%` }} /></div>
                {c.step && <p className="mt-2 text-base text-ink-soft">{c.step}</p>}
              </div>
            )}

            {params.get('tronque') && !failed && <p className="rounded-xl bg-brand-soft p-3 text-base">Ce cours est très long : seul son début a été utilisé.</p>}
            {failed && (<>
              <ErrorBox>{c.error ?? 'La création a échoué.'}</ErrorBox>
              <Link to="/etudiant/study/nouveau" className="btn-primary min-h-[52px] w-full text-lg">Importer un autre cours</Link>
            </>)}

            {c.missions.length > 0 && !failed && (
              <section className="card space-y-3">
                {c.summary && <p className="text-lg">{c.summary}</p>}
                <ul className="space-y-1.5">
                  {c.missions.map((m, i) => <li key={i} className="flex items-baseline justify-between gap-3 border-b border-line pb-1.5 last:border-0">
                    <span className="font-semibold">Mission {i + 1} · {m.title}</span><span className="shrink-0 text-sm text-ink-soft">{m.notions} notions</span></li>)}
                </ul>
              </section>
            )}

            </>}
          </>
        )}
      </main>
    </div>
  )
}
