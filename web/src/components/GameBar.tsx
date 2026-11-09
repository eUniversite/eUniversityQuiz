import { Link } from 'react-router-dom'
import type { Stats } from '../lib/study'

/** Pastille de profil de jeu : niveau, XP vers le prochain niveau, série de jours. */
/** `to` : la pastille devient un lien (vers « Mon évolution »). */
export function GameBar({ name, stats, to }: { name: string; stats: Stats | null; to?: string }) {
  const pct = stats ? (stats.levelXp / stats.levelSize) * 100 : 0
  const body = (
    <>
      <span className="gm-lvl" aria-label={`Niveau ${stats?.level ?? 1}`}>{stats?.level ?? 1}</span>
      <div className="min-w-0 flex-1">
        <p className="gm-title truncate text-lg leading-tight">{name}</p>
        <div className="gm-bar mt-2" role="progressbar" aria-label="Progression vers le niveau suivant" aria-valuenow={stats?.levelXp ?? 0} aria-valuemin={0} aria-valuemax={stats?.levelSize ?? 300}>
          <i style={{ width: `${pct}%` }} />
        </div>
      </div>
      {(stats?.streakDays ?? 0) > 0 && <span className="gm-pill shrink-0" title="Jours de suite avec une partie" aria-label={`Série de ${stats!.streakDays} jours`}>🔥 {stats!.streakDays}</span>}
    </>
  )
  const cls = 'gm-panel flex items-center gap-4'
  return to ? <Link to={to} className={cls + ' transition hover:-translate-y-0.5'} aria-label="Mon profil de jeu, voir mon évolution">{body}<span aria-hidden className="text-2xl text-ink-soft">›</span></Link> : <div className={cls}>{body}</div>
}
