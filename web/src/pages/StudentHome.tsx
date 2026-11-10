import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, signOut } from '../lib/api'
import { firstNameOf } from '../lib/student'
import type { Stats } from '../lib/study'
import { GameBar } from '../components/GameBar'
import { ErrorBox, Logo, Spinner } from '../components/ui'

interface Me { id: string; name: string; email: string }
interface CourseItem { id: string; title: string | null; fileName: string; status: string; questionCount: number; stars: number; maxStars: number }
const LABEL: Record<string, string> = { QUEUED: 'En attente…', EXTRACTING: 'En cours…', ANALYSING: 'Analyse…', CREATING: 'Création…', FAILED: 'Échec' }
const BANNERS = ['#ffd58a', '#a8e6bf', '#b9d4ff', '#ffc2d1', '#d9c7ff']

/** Espace étudiant = Study, présenté comme un jeu : profil, quêtes du jour, révisions dues, puis un « monde » par cours. */
export default function StudentHome() {
  const nav = useNavigate()
  const [me, setMe] = useState<Me | null>(null)
  const [courses, setCourses] = useState<CourseItem[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    document.title = 'Study — eUniversité'
    api('/student/me', { as: 'student' }).then(setMe).catch((e) => setError(e.message))
    api('/study/courses', { as: 'student' }).then(setCourses).catch(() => setCourses([]))
    api('/study/stats', { as: 'student' }).then(setStats).catch(() => {})
  }, [])
  const review = stats?.dueCourses[0]

  return (
    <div className="gm mx-auto min-h-dvh max-w-xl px-6 py-8">
      <header className="flex items-center justify-between">
        <Link to="/etudiant"><Logo className="h-10" /></Link>
        <div className="flex items-center gap-2">
          <Link to="/etudiant/abonnement" className="btn-ghost btn-sm">Abonnement</Link>
          <button className="btn-ghost btn-sm" onClick={() => { signOut(); nav('/') }}>Déconnexion</button>
        </div>
      </header>
      {!me ? (error ? <ErrorBox>{error}</ErrorBox> : <Spinner />) : (
        <main className="mt-10 space-y-8">
          <GameBar name={`Salut ${firstNameOf(me.name)}`} stats={stats} to="/etudiant/evolution" />

          {review && (
            <a href={`/jeu/index.html?course=${review.courseId}&review=1`} className="gm-btn hot w-full !flex-col !gap-0 !py-4" aria-label={`Réviser ${stats!.due} notions`}>
              <span className="text-lg">⚡ Révision du jour</span>
              <span className="text-base font-normal opacity-90">{stats!.due} notion{stats!.due > 1 ? 's' : ''} à rafraîchir</span>
            </a>
          )}

          {stats && (
            <details className="gm-panel group" aria-label="Quêtes du jour">
              <summary className="flex cursor-pointer list-none items-center justify-between">
                <span className="gm-title text-lg">Quêtes du jour</span>
                <span className="text-base font-semibold text-ink-soft">{stats.quests.filter((q) => q.value >= q.goal).length}/{stats.quests.length}</span>
              </summary>
              <ul className="mt-3 space-y-1">
                {stats.quests.map((q) => {
                  const done = q.value >= q.goal
                  return (
                    <li key={q.key} className="gm-quest">
                      <span className={`gm-check ${done ? 'done' : ''}`} aria-hidden>{done ? '✓' : ''}</span>
                      <span className={`flex-1 text-base ${done ? 'text-ink-soft line-through' : ''}`}>{q.label}</span>
                      <span className="sr-only">{done ? 'faite' : 'à faire'}</span>
                    </li>
                  )
                })}
              </ul>
            </details>
          )}

          <section className="space-y-4" aria-label="Mes cours">
            <h2 className="gm-title text-xl">Mes cours</h2>
            {!courses ? <Spinner /> : (
              <ul className="space-y-4">
                {courses.map((c, i) => (
                  <li key={c.id}>
                    <Link to={`/etudiant/study/${c.id}`} className="gm-world row">
                      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border-2 border-ink text-2xl" style={{ background: BANNERS[i % BANNERS.length] }} aria-hidden>📘</span>
                      <span className="min-w-0 flex-1">
                        <span className="gm-title block truncate text-lg">{c.title ?? c.fileName}</span>
                        {c.status === 'READY'
                          ? <span className="text-base text-ink-soft" aria-label={`${c.stars} étoiles sur ${c.maxStars}`}>⭐ {c.stars}/{c.maxStars}</span>
                          : <span className={`text-base ${c.status === 'FAILED' ? 'text-bad' : 'text-ink-soft'}`}>{LABEL[c.status] ?? c.status}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
                <li>
                  <Link to="/etudiant/study/nouveau" className="gm-world add !min-h-[84px]">
                    <span className="gm-title text-lg">＋ Importer un cours</span>
                  </Link>
                </li>
              </ul>
            )}
          </section>
        </main>
      )}
    </div>
  )
}
