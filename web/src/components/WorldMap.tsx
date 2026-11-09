import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { STATE_HINT, STATE_LABEL, type CourseProgress } from '../lib/study'
import { Spinner } from './ui'

const XS = [180, 262, 180, 98]     // zigzag : abscisses des étapes (largeur 360)
const GAP = 170

/** Carte du monde d'un cours : une étape par mission (verrouillée, ouverte, réussie), des étoiles, l'état Learn Engine et les révisions dues. */
export function WorldMap({ courseId }: { courseId: string }) {
  const [p, setP] = useState<CourseProgress | null>(null)
  const [sel, setSel] = useState<string | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { api(`/study/courses/${courseId}/progress`, { as: 'student' }).then((d: CourseProgress) => { setP(d); setSel(d.missions.find((m) => !m.locked && m.stars === 0)?.id ?? d.missions[0]?.id ?? null) }).catch((e) => setErr(e.message)) }, [courseId])
  if (err) return <p className="text-bad">{err}</p>
  if (!p) return <Spinner />

  const n = p.missions.length
  const pts = [...p.missions.map((_, i) => ({ x: XS[i % XS.length], y: 70 + (n - 1 - i) * GAP })), { x: 180, y: 70 - GAP + 10 }]   // départ en bas, diplôme en haut
  const height = 70 + (n - 1) * GAP + 80 + GAP - 10
  const shift = GAP - 10                                                                                                   // place pour le diplôme
  const P = pts.map((q, i) => ({ x: q.x, y: i === n ? 60 : q.y + shift }))
  const path = P.slice().reverse().map((q, i, a) => (i === 0 ? `M${q.x} ${q.y}` : `Q${(a[i - 1].x + q.x) / 2 + (i % 2 ? 40 : -40)} ${(a[i - 1].y + q.y) / 2} ${q.x} ${q.y}`)).join(' ')
  const cur = p.missions.find((m) => m.id === sel)
  const play = (q: string) => { location.href = `/jeu/index.html?course=${courseId}${q}` }

  return (
    <div className="space-y-8">
      <div className="gm-map" style={{ height }}>
        <svg viewBox={`0 0 360 ${height}`} className="absolute inset-0 h-full w-full" aria-hidden>
          <path d={path} fill="none" stroke="rgb(var(--ink) / .25)" strokeWidth="10" strokeLinecap="round" strokeDasharray="2 20" />
        </svg>
        <div className="gm-node done absolute !bg-[#ffc93c]" style={{ left: `${(P[n].x / 360) * 100}%`, top: P[n].y, cursor: 'default' }} aria-label="Diplôme">🎓</div>
        {p.missions.map((m, i) => {
          const cls = m.locked ? 'locked' : m.stars > 0 ? 'done' : 'current'
          return (
            <button key={m.id} type="button" disabled={m.locked} aria-label={`${m.title}, ${m.locked ? 'verrouillée' : STATE_LABEL[m.state]}, ${m.stars} étoiles sur 3`}
              className={`gm-node ${cls} ${sel === m.id ? 'sel' : ''}`} style={{ left: `${(P[i].x / 360) * 100}%`, top: P[i].y }} onClick={() => setSel(m.id)}>
              {m.locked ? '🔒' : i + 1}
              {!m.locked && <span className="gm-stars" aria-hidden>{[1, 2, 3].map((s) => <span key={s} style={{ opacity: s <= m.stars ? 1 : .25 }}>⭐</span>)}</span>}
              {m.due > 0 && <span className="gm-due" aria-hidden>{m.due}</span>}
            </button>
          )
        })}
      </div>

      {cur && (
        <section className="gm-panel space-y-3" aria-live="polite">
          <div className="flex items-start justify-between gap-3">
            <h2 className="gm-title text-lg leading-snug">{cur.title}</h2>
            {!cur.locked && <span className={`gm-chip ${cur.state}`}>{STATE_LABEL[cur.state]}</span>}
          </div>
          <p className="text-base text-ink-soft">{cur.locked ? 'Décroche une étoile à la mission précédente pour l’ouvrir.' : STATE_HINT[cur.state]}</p>
          {!cur.locked && <button className="gm-btn w-full" onClick={() => play(`&mission=${cur.id}`)}>{cur.stars ? 'Rejouer' : 'Jouer'}</button>}
        </section>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {p.due > 0 && <button className="gm-btn hot" onClick={() => play('&review=1')}>⚡ Réviser · {p.due}</button>}
        <button className="gm-btn alt" onClick={() => play('')}>Course complète</button>
      </div>
    </div>
  )
}
