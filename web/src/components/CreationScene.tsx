import { useEffect, useState } from 'react'

export interface SceneMission { title: string; notions: number; labels?: string[] }
interface Props { status: string; progress: number; step: string | null; missions: SceneMission[] }

const LINES = [92, 70, 84, 58, 90, 64, 78, 46, 88, 66]       // largeur (%) des lignes de texte de la feuille

/** Étapes affichées sous le titre : lecture du cours, repérage des chapitres, écriture des questions. */
function Track({ stage }: { stage: 0 | 1 | 2 }) {
  const labels = ['Lecture', 'Chapitres', 'Questions']
  return (
    <ol className="cs-track" aria-label="Étapes de la création">
      {labels.map((l, i) => (
        <li key={l} className={i < stage ? 'done' : i === stage ? 'on' : ''} aria-current={i === stage ? 'step' : undefined}>
          <span className="cs-dot">{i < stage ? '✓' : i + 1}</span><span className="cs-lbl">{l}</span>
        </li>
      ))}
    </ol>
  )
}

/** Mise en scène animée de la création d'un parcours (lecture, analyse, création des questions). Les animations sont coupées si l'appareil demande moins de mouvement. */
export function CreationScene({ status, progress, step, missions }: Props) {
  const building = status === 'CREATING' && missions.length > 0
  const stage: 0 | 1 | 2 = building ? 2 : status === 'ANALYSING' ? 0 : 0
  const n = missions.length
  const done = building ? Math.min(n, Math.floor((Math.max(0, progress - 20) / 70) * n + 1e-6)) : 0
  const caption = building ? (step ?? 'Création des questions') : status === 'QUEUED' ? 'Ton cours attend son tour' : 'Je lis ton cours'

  return (
    <section className="cs" aria-label="Création du parcours">
      <Track stage={stage} />

      {!building ? (
        <div className="cs-read" aria-hidden>
          <div className="cs-sheet">
            {LINES.map((w, i) => <span key={i} className="cs-line" style={{ width: `${w}%`, '--i': i } as React.CSSProperties} />)}
            <span className="cs-beam" />
          </div>
          <span className="cs-spark s1" /><span className="cs-spark s2" /><span className="cs-spark s3" />
        </div>
      ) : (
        <ul className="cs-chapters">
          {missions.map((m, i) => {
            const state = i < done ? 'done' : i === done ? 'active' : 'wait'
            return (
              <li key={i} className={`cs-card ${state}`} style={{ '--d': `${i * 0.18}s` } as React.CSSProperties}>
                <span className="cs-num">{state === 'done' ? '✓' : i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="cs-title">{m.title}</p>
                  {(m.labels?.length ?? 0) > 0 && (
                    <ul className="cs-chips">
                      {m.labels!.map((l, k) => <li key={k} style={{ '--d': `${0.5 + i * 0.18 + k * 0.12}s` } as React.CSSProperties}>{l}</li>)}
                    </ul>
                  )}
                </div>
                {state === 'active' && <span className="cs-bubbles" aria-hidden><i>?</i><i>?</i><i>?</i></span>}
              </li>
            )
          })}
        </ul>
      )}

      <div className="cs-foot" role="status" aria-live="polite">
        <div className="gm-bar"><i style={{ width: `${Math.max(progress, 6)}%` }} /></div>
        <p className="cs-cap">{caption}<span className="cs-dots" aria-hidden /></p>
      </div>
    </section>
  )
}

/** Courte célébration quand le parcours devient prêt. */
export function ReadyBurst() {
  const [bits] = useState(() => Array.from({ length: 22 }, (_, i) => {
    const a = (i / 22) * Math.PI * 2, r = 90 + (i % 3) * 38
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, c: ['#FF9F0A', '#FFC93C', '#2f9e5b', '#4d8dff', '#ff4d6d'][i % 5], d: (i % 4) * 0.04 }
  }))
  return (
    <div className="cs-ready" role="status">
      <div className="cs-burst" aria-hidden>
        {bits.map((b, i) => <i key={i} style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--c': b.c, '--d': `${b.d}s` } as React.CSSProperties} />)}
        <span className="cs-trophy">🎓</span>
      </div>
      <p className="gm-title text-2xl">Ton parcours est prêt !</p>
    </div>
  )
}
