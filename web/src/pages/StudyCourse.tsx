import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../lib/api'
import { ErrorBox, Logo, Spinner } from '../components/ui'
import { WorldMap } from '../components/WorldMap'
import { CreationScene, ReadyBurst } from '../components/CreationScene'

interface Course {
  id: string; fileName: string; title: string | null; status: 'QUEUED' | 'EXTRACTING' | 'ANALYSING' | 'CREATING' | 'READY' | 'FAILED'; error: string | null; progress: number; step: string | null
  summary: string | null; missions: { title: string; notions: number; labels?: string[] }[]; questionCount: number
}

/** Suivi animé de la création du parcours, puis carte des missions une fois prêt. */
export default function StudyCourse() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const [c, setC] = useState<Course | null>(null)
  const [error, setError] = useState('')
  const [burst, setBurst] = useState(false)
  useEffect(() => { document.title = 'Mon parcours — eUniversité Study' }, [])

  useEffect(() => {
    let stop = false
    let timer: number
    const tick = async () => {
      try {
        const d: Course = await api(`/study/courses/${id}`, { as: 'student' })
        if (stop) return
        setC((prev) => { if (prev && prev.status !== 'READY' && prev.status !== 'FAILED' && d.status === 'READY') { setBurst(true); window.setTimeout(() => setBurst(false), 2400) } return d })
        if (d.status !== 'READY' && d.status !== 'FAILED') timer = window.setTimeout(tick, 1500)
      } catch (e) { if (!stop) setError((e as Error).message) }
    }
    tick()
    return () => { stop = true; clearTimeout(timer) }
  }, [id])

  const failed = c?.status === 'FAILED'

  return (
    <div className="gm mx-auto min-h-dvh max-w-xl px-6 py-8">
      <header className="flex items-center justify-between"><Link to="/etudiant"><Logo className="h-10" /></Link>
        <Link to="/etudiant" className="text-base font-semibold text-ink-soft underline-offset-4 hover:underline">Mon espace</Link></header>
      <main className="mt-10 space-y-8">
        {error ? <ErrorBox>{error}</ErrorBox> : !c ? <Spinner /> : (
          <>
            <div><h1 className="gm-title text-3xl">{c.title ?? 'Je prépare ton parcours'}</h1>
              {c.status !== 'READY' && <p className="mt-1 break-all text-ink-soft">{c.fileName}</p>}</div>

            {c.status === 'READY' ? (burst ? <ReadyBurst /> : <div className="cs-fade"><WorldMap courseId={c.id} /></div>) : <>
              {!failed && <CreationScene status={c.status} progress={c.progress} step={c.step} missions={c.missions} />}

              {params.get('tronque') && !failed && <p className="rounded-xl bg-brand-soft p-3 text-base">Ce cours est très long : seul son début a été utilisé.</p>}
              {failed && (<>
                <ErrorBox>{c.error ?? 'La création a échoué.'}</ErrorBox>
                <Link to="/etudiant/study/nouveau" className="btn-primary min-h-[52px] w-full text-lg">Importer un autre cours</Link>
              </>)}
            </>}
          </>
        )}
      </main>
    </div>
  )
}
