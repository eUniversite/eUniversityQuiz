import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { STATE_LABEL, type NotionState } from '../lib/study'
import { ErrorBox, Logo, Spinner } from '../components/ui'

interface Evo {
  notions: number; mastered: number; pct: number; streakDays: number; due: number; dueCourseId: string | null
  courses: { id: string; title: string; notions: number; mastered: number; pct: number }[]
  weak: { courseId: string; course: string; label: string; state: NotionState }[]
  week: { day: string; played: boolean }[]
}
const DAYS = ['D', 'L', 'M', 'M', 'J', 'V', 'S']

/** Cercle de maîtrise : la part des notions bien retenues. */
function Ring({ pct }: { pct: number }) {
  const r = 52, c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 128 128" className="h-36 w-36 shrink-0" role="img" aria-label={`${pct} % des notions bien retenues`}>
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgb(var(--ink) / .1)" strokeWidth="14" />
      <circle cx="64" cy="64" r={r} fill="none" stroke="rgb(var(--brand))" strokeWidth="14" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} transform="rotate(-90 64 64)" style={{ transition: 'stroke-dashoffset .9s cubic-bezier(.2,1,.3,1)' }} />
      <text x="64" y="64" textAnchor="middle" dominantBaseline="central" fontSize="30" fontWeight="600" fill="rgb(var(--ink))">{pct} %</text>
    </svg>
  )
}

/** « Mon évolution » : trois repères seulement (maîtrise, points à retravailler, régularité). */
export default function Evolution() {
  const [e, setE] = useState<Evo | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { document.title = 'Mon évolution — eUniversité Study'; api('/study/evolution', { as: 'student' }).then(setE).catch((x) => setError(x.message)) }, [])

  return (
    <div className="gm mx-auto min-h-dvh max-w-xl px-6 py-8">
      <header className="flex items-center justify-between">
        <Link to="/etudiant"><Logo className="h-10" /></Link>
        <Link to="/etudiant" className="text-base font-semibold text-ink-soft underline-offset-4 hover:underline">Mon espace</Link>
      </header>
      <main className="mt-10 space-y-8">
        <h1 className="gm-title text-3xl">Mon évolution</h1>
        {error ? <ErrorBox>{error}</ErrorBox> : !e ? <Spinner /> : e.notions === 0 ? (
          <section className="gm-panel space-y-4 text-center">
            <p className="text-lg">Joue ta première mission pour voir ici ce que tu retiens.</p>
            <Link to="/etudiant" className="gm-btn">Retour à mon espace</Link>
          </section>
        ) : (
          <>
            <section className="gm-panel flex items-center gap-6" aria-label="Maîtrise">
              <Ring pct={e.pct} />
              <div>
                <p className="gm-title text-xl leading-snug">{e.mastered} notion{e.mastered > 1 ? 's' : ''} sur {e.notions} bien retenue{e.mastered > 1 ? 's' : ''}</p>
                <p className="mt-2 text-base text-ink-soft">Un repère de ta pratique, pas une note.</p>
              </div>
            </section>

            <section className="gm-panel space-y-4" aria-label="À retravailler">
              <h2 className="gm-title text-lg">À retravailler</h2>
              {e.weak.length === 0 ? <p className="text-base text-ink-soft">Rien à reprendre pour l’instant. Bravo !</p> : (
                <ul className="space-y-4">
                  {e.weak.map((w, i) => (
                    <li key={i}>
                      <Link to={`/etudiant/study/${w.courseId}`} className="flex items-center justify-between gap-3">
                        <span className="min-w-0"><span className="gm-title block truncate text-base">{w.label}</span><span className="block truncate text-sm text-ink-soft">{w.course}</span></span>
                        <span className={`gm-chip ${w.state}`}>{STATE_LABEL[w.state]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {e.due > 0 && e.dueCourseId && <a href={`/jeu/index.html?course=${e.dueCourseId}&review=1`} className="gm-btn hot w-full">⚡ Réviser · {e.due}</a>}
            </section>

            <section className="gm-panel space-y-4" aria-label="Régularité">
              <div className="flex items-baseline justify-between"><h2 className="gm-title text-lg">Cette semaine</h2>{e.streakDays > 0 && <span className="text-base font-semibold text-ink-soft">🔥 {e.streakDays} jour{e.streakDays > 1 ? 's' : ''} de suite</span>}</div>
              <ul className="flex justify-between">
                {e.week.map((d) => (
                  <li key={d.day} className="flex flex-col items-center gap-2" aria-label={`${d.day} : ${d.played ? 'joué' : 'pas joué'}`}>
                    <span className={`grid h-9 w-9 place-items-center rounded-full border-2 border-ink text-sm font-semibold ${d.played ? 'bg-brand' : 'bg-card'}`}>{d.played ? '✓' : ''}</span>
                    <span className="text-sm text-ink-soft">{DAYS[new Date(d.day + 'T12:00:00Z').getUTCDay()]}</span>
                  </li>
                ))}
              </ul>
            </section>

            {e.courses.length > 1 && (
              <section className="gm-panel space-y-4" aria-label="Par cours">
                <h2 className="gm-title text-lg">Par cours</h2>
                <ul className="space-y-4">
                  {e.courses.map((c) => (
                    <li key={c.id}>
                      <Link to={`/etudiant/study/${c.id}`} className="block">
                        <span className="flex justify-between gap-3 text-base"><span className="truncate">{c.title}</span><span className="font-semibold">{c.pct} %</span></span>
                        <span className="gm-bar mt-2 block"><i style={{ width: `${c.pct}%` }} /></span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
