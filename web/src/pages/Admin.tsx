import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { fcfa } from '../lib/billing'
import { ErrorBox, Logo, Spinner } from '../components/ui'

type Tab = 'stats' | 'students' | 'payments' | 'courses'
const TABS: [Tab, string][] = [['stats', 'Tableau de bord'], ['students', 'Étudiants'], ['payments', 'Paiements'], ['courses', 'Cours']]
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const PAY: Record<string, string> = { PENDING: 'En attente', COMPLETED: 'Payé', FAILED: 'Échoué' }

/** Backoffice : suivi des données de l'application. Accès : enseignant dont l'e-mail est dans ADMIN_EMAILS. */
export default function Admin() {
  const [tab, setTab] = useState<Tab>('stats')
  const [ok, setOk] = useState<boolean | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { document.title = 'Backoffice — eUniversité'; api('/admin/me').then(() => setOk(true)).catch((e) => { setOk(false); setMsg(e.message) }) }, [])

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <Link to="/enseignant"><Logo className="h-10" /></Link>
        <span className="text-base font-bold text-ink-soft">Backoffice</span>
      </header>
      {ok === null ? <Spinner /> : !ok ? <div className="mt-8"><ErrorBox>{msg}</ErrorBox></div> : (
        <>
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Sections">
            {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={tab === k ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'}>{l}</button>)}
          </nav>
          <main className="mt-6">
            {tab === 'stats' && <Stats />}
            {tab === 'students' && <Students />}
            {tab === 'payments' && <Payments />}
            {tab === 'courses' && <Courses />}
          </main>
        </>
      )}
    </div>
  )
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null); const [error, setError] = useState('')
  const load = useCallback(() => { api<T>(path).then((d) => { setData(d); setError('') }).catch((e) => setError(e.message)) }, [path])
  useEffect(() => { setData(null); load() }, [load])
  return { data, error, reload: load }
}

const Tile = ({ label, value, hint }: { label: string; value: string | number; hint?: string }) => (
  <div className="card !p-4"><div className="text-sm text-ink-soft">{label}</div><div className="mt-1 text-2xl font-extrabold">{value}</div>{hint && <div className="text-sm text-ink-soft">{hint}</div>}</div>
)

function Stats() {
  const { data: s, error } = useLoad<any>('/admin/stats')
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!s) return <Spinner />
  const max = Math.max(1, ...s.signups.map((d: any) => d.n))
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Étudiants" value={s.students} hint={`+${s.newThisWeek} cette semaine`} />
        <Tile label="Abonnés actifs" value={s.subscribers} hint={`${s.monthly} mensuel · ${s.yearly} annuel`} />
        <Tile label="Plan Découverte" value={s.free} />
        <Tile label="Comptes suspendus" value={s.blocked} />
        <Tile label="Revenus (30 j)" value={fcfa(s.revenue30)} />
        <Tile label="Revenus (total)" value={fcfa(s.revenue)} hint={`${s.payments} paiements`} />
        <Tile label="Paiements en attente" value={s.pendingPayments} />
        <Tile label="Parties (7 j)" value={s.gamesThisWeek} />
        <Tile label="Cours créés" value={s.courses} hint={`${s.readyCourses} prêts`} />
        <Tile label="Cours en échec" value={s.failedCourses} />
      </div>
      <section className="card">
        <h2 className="text-lg font-extrabold">Inscriptions, 14 derniers jours</h2>
        <div className="mt-4 flex h-32 items-end gap-1" role="img" aria-label="Inscriptions par jour">
          {s.signups.map((d: any) => (
            <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1" title={`${day(d.day)} : ${d.n}`}>
              <span className="text-xs text-ink-soft">{d.n || ''}</span>
              <div className="w-full rounded-t bg-brand" style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 4 : 1, opacity: d.n ? 1 : .25 }} />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size))
  return (
    <div className="mt-4 flex items-center justify-between text-base text-ink-soft">
      <span>{total} résultat{total > 1 ? 's' : ''}</span>
      <span className="flex items-center gap-2">
        <button className="btn-ghost btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>Précédent</button>
        <span>{page} / {pages}</span>
        <button className="btn-ghost btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Suivant</button>
      </span>
    </div>
  )
}

function Students() {
  const [q, setQ] = useState(''); const [term, setTerm] = useState(''); const [page, setPage] = useState(1)
  const { data, error, reload } = useLoad<any>(`/admin/students?q=${encodeURIComponent(term)}&page=${page}`)
  const [err, setErr] = useState('')
  useEffect(() => { const t = setTimeout(() => { setTerm(q); setPage(1) }, 300); return () => clearTimeout(t) }, [q])
  const act = async (path: string, body: unknown, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return
    setErr(''); try { await api(path, { body }); reload() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <div className="space-y-4">
      <input className="field" type="search" placeholder="Rechercher par e-mail ou nom" aria-label="Rechercher un étudiant" value={q} onChange={(e) => setQ(e.target.value)} />
      {(error || err) && <ErrorBox>{error || err}</ErrorBox>}
      {!data ? <Spinner /> : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-[760px] text-left text-base">
              <thead className="text-sm text-ink-soft"><tr><th className="p-3">Étudiant</th><th className="p-3">Inscrit le</th><th className="p-3">Connexion</th><th className="p-3">Cours</th><th className="p-3">Plan</th><th className="p-3 text-right">Actions</th></tr></thead>
              <tbody>
                {data.items.map((s: any) => (
                  <tr key={s.id} className="border-t border-line align-top">
                    <td className="p-3"><div className="font-bold">{s.name}</div><div className="text-sm text-ink-soft">{s.email}</div></td>
                    <td className="p-3">{day(s.createdAt)}</td>
                    <td className="p-3">{[s.google && 'Google', s.password && 'Mot de passe'].filter(Boolean).join(' + ')}</td>
                    <td className="p-3">{s.courses}</td>
                    <td className="p-3">{s.blocked ? <span className="font-bold text-bad">Suspendu</span> : s.plan ? <>{s.plan === 'YEARLY' ? 'Annuel' : 'Mensuel'}<div className="text-sm text-ink-soft">jusqu’au {day(s.endsAt)}</div></> : 'Découverte'}</td>
                    <td className="p-3"><div className="flex flex-wrap justify-end gap-2">
                      <button className="btn-ghost btn-sm" onClick={() => act(`/admin/students/${s.id}/grant`, { plan: 'MONTHLY' }, `Offrir 1 mois à ${s.email} ?`)}>+1 mois</button>
                      <button className="btn-ghost btn-sm" onClick={() => act(`/admin/students/${s.id}/grant`, { plan: 'YEARLY' }, `Offrir 1 an à ${s.email} ?`)}>+1 an</button>
                      <button className="btn-ghost btn-sm" onClick={() => act(`/admin/students/${s.id}/block`, { blocked: !s.blocked }, s.blocked ? undefined : `Suspendre ${s.email} ?`)}>{s.blocked ? 'Réactiver' : 'Suspendre'}</button>
                    </div></td>
                  </tr>
                ))}
                {!data.items.length && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Aucun étudiant.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} size={data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  )
}

function Payments() {
  const [status, setStatus] = useState(''); const [page, setPage] = useState(1)
  const { data, error, reload } = useLoad<any>(`/admin/payments?status=${status}&page=${page}`)
  const [note, setNote] = useState('')
  const check = async (id: string) => {
    setNote('')
    try { const r = await api(`/admin/payments/${id}/check`, { method: 'POST', body: {} }); setNote(`Statut chez GeniusPay : ${r.remote ?? '—'} → ${PAY[r.status] ?? r.status}`); reload() }
    catch (e) { setNote((e as Error).message) }
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filtrer par statut">
        {[['', 'Tous'], ['PENDING', 'En attente'], ['COMPLETED', 'Payés'], ['FAILED', 'Échoués']].map(([k, l]) => <button key={k} className={status === k ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => { setStatus(k); setPage(1) }}>{l}</button>)}
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {note && <p className="rounded-xl bg-brand-soft p-3 text-base">{note}</p>}
      {!data ? <Spinner /> : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-line bg-card">
            <table className="w-full min-w-[680px] text-left text-base">
              <thead className="text-sm text-ink-soft"><tr><th className="p-3">Date</th><th className="p-3">Étudiant</th><th className="p-3">Formule</th><th className="p-3">Montant</th><th className="p-3">Statut</th><th className="p-3" /></tr></thead>
              <tbody>
                {data.items.map((p: any) => (
                  <tr key={p.id} className="border-t border-line">
                    <td className="p-3">{day(p.createdAt)}</td>
                    <td className="p-3">{p.email}</td>
                    <td className="p-3">{p.plan === 'YEARLY' ? 'Annuel' : 'Mensuel'}{p.offered && <span className="ml-2 text-sm text-ink-soft">offert</span>}</td>
                    <td className="p-3">{fcfa(p.amount)}</td>
                    <td className={`p-3 font-semibold ${p.status === 'FAILED' ? 'text-bad' : p.status === 'COMPLETED' ? 'text-ok' : ''}`}>{PAY[p.status]}</td>
                    <td className="p-3 text-right">{p.status === 'PENDING' && p.gatewayRef && <button className="btn-ghost btn-sm" onClick={() => check(p.id)}>Vérifier</button>}</td>
                  </tr>
                ))}
                {!data.items.length && <tr><td colSpan={6} className="p-6 text-center text-ink-soft">Aucun paiement.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pager page={data.page} total={data.total} size={data.pageSize} onPage={setPage} />
        </>
      )}
    </div>
  )
}

function Courses() {
  const [failed, setFailed] = useState(true)
  const { data, error } = useLoad<any[]>(`/admin/courses${failed ? '?status=FAILED' : ''}`)
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <button className={failed ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setFailed(true)}>En échec</button>
        <button className={!failed ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} onClick={() => setFailed(false)}>Récents</button>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {!data ? <Spinner /> : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-card">
          <table className="w-full min-w-[680px] text-left text-base">
            <thead className="text-sm text-ink-soft"><tr><th className="p-3">Date</th><th className="p-3">Étudiant</th><th className="p-3">Fichier</th><th className="p-3">Statut</th><th className="p-3">Questions</th></tr></thead>
            <tbody>
              {data.map((c) => (
                <tr key={c.id} className="border-t border-line align-top">
                  <td className="p-3">{day(c.createdAt)}</td><td className="p-3">{c.email}</td>
                  <td className="p-3 break-all">{c.title ?? c.fileName}</td>
                  <td className="p-3">{c.status}{c.error && <div className="text-sm text-bad">{c.error}</div>}</td>
                  <td className="p-3">{c.questions}</td>
                </tr>
              ))}
              {!data.length && <tr><td colSpan={5} className="p-6 text-center text-ink-soft">Rien à signaler.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
