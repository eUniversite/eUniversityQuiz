import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api as base, setAdminToken } from '../lib/api'
import { fcfa } from '../lib/billing'
import { ErrorBox, Logo, Spinner } from '../components/ui'
import { PasswordInput } from '../components/PasswordInput'

type Tab = 'stats' | 'students' | 'payments' | 'courses' | 'logs' | 'account' | 'danger'
const TABS: [Tab, string][] = [['stats', 'Tableau de bord'], ['students', 'Étudiants'], ['payments', 'Paiements'], ['courses', 'Cours'], ['logs', 'Journal'], ['account', 'Mon compte'], ['danger', 'Zone dangereuse']]
/** Tous les appels du backoffice portent le jeton administrateur. */
const api = <T = any>(path: string, opts: { method?: string; body?: unknown } = {}) => base<T>(path, { ...opts, as: 'admin' })
const day = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
const PAY: Record<string, string> = { PENDING: 'En attente', COMPLETED: 'Payé', FAILED: 'Échoué' }

/** Backoffice : suivi des données de l'application. Accès : enseignant dont l'e-mail est dans ADMIN_EMAILS. */
export default function Admin() {
  const [tab, setTab] = useState<Tab>('stats')
  const nav = useNavigate()
  const [me, setMe] = useState<{ name: string; email: string } | null>(null)
  const [msg, setMsg] = useState('')
  useEffect(() => { document.title = 'Backoffice — eUniversité'; api('/admin/me').then(setMe).catch((e) => setMsg(e.message)) }, [])
  const ok = me ? true : msg ? false : null

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 py-6">
      <header className="flex items-center justify-between gap-4">
        <Logo className="h-10" />
        <span className="flex items-center gap-3 text-base text-ink-soft"><span className="hidden sm:inline">{me?.email}</span>
          <button className="btn-ghost btn-sm" onClick={() => { setAdminToken(null); nav('/admin/connexion', { replace: true }) }}>Déconnexion</button></span>
      </header>
      {ok === null ? <Spinner /> : !ok ? <div className="mt-8"><ErrorBox>{msg}</ErrorBox></div> : (
        <>
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Sections">
            {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} aria-current={tab === k} className={`${tab === k ? 'btn-primary btn-sm' : 'btn-ghost btn-sm'} ${k === 'danger' ? 'ml-auto !text-bad' : ''}`}>{l}</button>)}
          </nav>
          <main className="mt-6">
            {tab === 'stats' && <Stats />}
            {tab === 'students' && <Students />}
            {tab === 'payments' && <Payments />}
            {tab === 'courses' && <Courses />}
            {tab === 'logs' && <Logs />}
            {tab === 'account' && <Account />}
            {tab === 'danger' && <DangerZone />}
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

const ACTIONS: Record<string, string> = {
  login: 'Connexion', 'login.echec': 'Connexion refusée', 'mot-de-passe': 'Changement de mot de passe', 'abonnement.offrir': 'Abonnement offert',
  purge: 'DONNÉES SUPPRIMÉES', 'purge.apercu': 'Suppression : aperçu', 'purge.refusee': 'Suppression refusée',
  'etudiant.suspendre': 'Étudiant suspendu', 'etudiant.reactiver': 'Étudiant réactivé', 'paiement.verifier': 'Paiement vérifié',
}
const hour = (iso: string) => new Date(iso).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function Logs() {
  const [page, setPage] = useState(1)
  const { data, error } = useLoad<any>(`/admin/logs?page=${page}`)
  if (error) return <ErrorBox>{error}</ErrorBox>
  if (!data) return <Spinner />
  return (
    <div>
      <div className="overflow-x-auto rounded-2xl border border-line bg-card">
        <table className="w-full min-w-[680px] text-left text-base">
          <thead className="text-sm text-ink-soft"><tr><th className="p-3">Quand</th><th className="p-3">Administrateur</th><th className="p-3">Action</th><th className="p-3">Cible</th><th className="p-3">IP</th></tr></thead>
          <tbody>
            {data.items.map((l: any) => (
              <tr key={l.id} className="border-t border-line align-top">
                <td className="p-3 whitespace-nowrap">{hour(l.createdAt)}</td><td className="p-3">{l.adminEmail}</td>
                <td className={`p-3 ${['login.echec', 'purge', 'purge.refusee'].includes(l.action) ? 'font-semibold text-bad' : ''}`}>{ACTIONS[l.action] ?? l.action}{l.detail && <div className="text-sm text-ink-soft">{l.detail}</div>}</td>
                <td className="p-3 break-all">{l.target ?? '—'}</td><td className="p-3 text-sm text-ink-soft">{l.ip ?? '—'}</td>
              </tr>
            ))}
            {!data.items.length && <tr><td colSpan={5} className="p-6 text-center text-ink-soft">Journal vide.</td></tr>}
          </tbody>
        </table>
      </div>
      <Pager page={data.page} total={data.total} size={data.pageSize} onPage={setPage} />
    </div>
  )
}

function Account() {
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [again, setAgain] = useState('')
  const [error, setError] = useState(''); const [done, setDone] = useState(false); const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(''); setDone(false)
    if (next.length < 12) return setError('12 caractères minimum.')
    if (next !== again) return setError('Les deux mots de passe ne sont pas identiques.')
    setBusy(true)
    try { const r = await api('/admin/password', { body: { current, next } }); setAdminToken(r.token); setDone(true); setCurrent(''); setNext(''); setAgain('') }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} className="card max-w-md space-y-4">
      <h2 className="text-lg font-extrabold">Changer mon mot de passe</h2>
      <div><label htmlFor="cur" className="label">Mot de passe actuel</label><PasswordInput id="cur" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required /></div>
      <div><label htmlFor="nw" className="label">Nouveau mot de passe (12 caractères minimum)</label><PasswordInput id="nw" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" required /></div>
      <div><label htmlFor="ag" className="label">Confirmation</label><PasswordInput id="ag" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" required /></div>
      {error && <ErrorBox>{error}</ErrorBox>}
      {done && <p className="rounded-xl bg-ok/10 p-3 text-base font-medium text-ok">Mot de passe modifié. Les autres sessions sont déconnectées.</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
    </form>
  )
}

type Scope = 'students' | 'live' | 'all'
interface PurgeStatus { enabled: boolean; minDelaySec: number; scopes: Record<Scope, { label: string; phrase: string }> }
interface Preview { token: string; phrase: string; minDelaySec: number; expiresInSec: number; counts: { label: string; n: number }[] }
const SCOPE_HELP: Record<Scope, string> = {
  students: 'Tous les comptes étudiants, leurs cours, questions, parties, paiements et abonnements.',
  live: 'Tous les quiz et sessions Live, avec leurs participants et réponses. Les comptes enseignants sont conservés.',
  all: 'Les deux ensembles ci-dessus.',
}

/** Vider les données de test : volontairement long (aperçu, délai imposé, phrase à recopier, mot de passe demandé deux fois). */
function DangerZone() {
  const [status, setStatus] = useState<PurgeStatus | null>(null)
  const [step, setStep] = useState<'intro' | 'scope' | 'password' | 'confirm' | 'done'>('intro')
  const [scope, setScope] = useState<Scope>('students')
  const [pw1, setPw1] = useState(''); const [pw2, setPw2] = useState('')
  const [prev, setPrev] = useState<Preview | null>(null)
  const [left, setLeft] = useState(0)
  const [ack1, setAck1] = useState(false); const [ack2, setAck2] = useState(false); const [phrase, setPhrase] = useState('')
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ label: string; n: number }[]>([])
  useEffect(() => { api<PurgeStatus>('/admin/purge/status').then(setStatus).catch((e) => setError(e.message)) }, [])
  useEffect(() => { if (left <= 0) return; const t = setTimeout(() => setLeft(left - 1), 1000); return () => clearTimeout(t) }, [left])
  const reset = () => { setStep('intro'); setPw1(''); setPw2(''); setPrev(null); setAck1(false); setAck2(false); setPhrase(''); setError(''); setLeft(0) }

  async function preview(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api<Preview>('/admin/purge/preview', { body: { scope, password: pw1 } }); setPrev(r); setLeft(r.minDelaySec); setPw1(''); setStep('confirm') }
    catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }
  async function execute(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { const r = await api('/admin/purge/execute', { body: { scope, password: pw2, token: prev!.token, phrase } }); setResult(r.counts); setStep('done') }
    catch (err) { setError((err as Error).message); setPw2('') } finally { setBusy(false) }
  }

  if (!status) return error ? <ErrorBox>{error}</ErrorBox> : <Spinner />
  const needed = status.scopes[scope].phrase
  const ready = ack1 && ack2 && phrase === needed && pw2.length > 0 && left <= 0

  return (
    <div className="mx-auto max-w-xl rounded-2xl border-2 border-bad/40 p-6">
      <h2 className="text-xl font-extrabold text-bad">Zone dangereuse</h2>
      <p className="mt-2 text-base text-ink-soft">Cette zone supprime définitivement des données de la base. Elle sert à nettoyer les données de test avant le lancement.</p>

      {!status.enabled ? <p className="mt-6 rounded-xl bg-bad/10 p-4 text-base font-medium text-bad">Désactivée sur ce serveur (DISABLE_DATA_PURGE).</p> : step === 'intro' && (<>
        <ul className="mt-6 list-disc space-y-2 pl-5 text-base">
          <li>L’action est <strong>irréversible</strong> : il n’y a pas d’annulation ni de corbeille.</li>
          <li>Les <strong>comptes administrateurs</strong>, les <strong>comptes enseignants</strong> et le <strong>journal d’audit</strong> ne sont jamais supprimés.</li>
          <li>Faites une sauvegarde de la base avant de continuer si le moindre doute subsiste.</li>
          <li>Il faudra : choisir ce qui est supprimé, saisir votre mot de passe, attendre {status.minDelaySec} secondes, recopier une phrase, puis ressaisir votre mot de passe.</li>
        </ul>
        {/* Le bouton est volontairement tout en bas, après un grand espace : on ne l'atteint pas par accident. */}
        <div style={{ height: '70vh' }} aria-hidden />
        <button className="btn-ghost btn-sm !border-bad !text-bad" onClick={() => setStep('scope')}>Je veux vider des données…</button>
      </>)}

      {status.enabled && step === 'scope' && (
        <div className="mt-6 space-y-4">
          <h3 className="text-lg font-bold">1. Que faut-il supprimer ?</h3>
          <div role="radiogroup" className="space-y-3">
            {(Object.keys(status.scopes) as Scope[]).map((k) => (
              <button key={k} type="button" role="radio" aria-checked={scope === k} onClick={() => setScope(k)} className={`w-full rounded-xl border-2 p-4 text-left ${scope === k ? 'border-bad bg-bad/5' : 'border-line'}`}>
                <div className="font-bold">{status.scopes[k].label}</div><div className="text-sm text-ink-soft">{SCOPE_HELP[k]}</div>
              </button>
            ))}
          </div>
          <div className="flex justify-between"><button className="btn-ghost btn-sm" onClick={reset}>Annuler</button><button className="btn-ghost btn-sm !border-bad !text-bad" onClick={() => setStep('password')}>Continuer</button></div>
        </div>
      )}

      {status.enabled && step === 'password' && (
        <form onSubmit={preview} className="mt-6 space-y-4">
          <h3 className="text-lg font-bold">2. Confirmez que c’est bien vous</h3>
          <p className="text-base text-ink-soft">Périmètre choisi : <strong>{status.scopes[scope].label}</strong>. Saisissez votre mot de passe pour voir précisément ce qui sera supprimé.</p>
          <PasswordInput id="p1" value={pw1} onChange={(e) => setPw1(e.target.value)} autoComplete="current-password" placeholder="Votre mot de passe administrateur" required autoFocus />
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex justify-between"><button type="button" className="btn-ghost btn-sm" onClick={reset}>Annuler</button><button className="btn-ghost btn-sm !border-bad !text-bad" disabled={busy || !pw1}>{busy ? 'Vérification…' : 'Voir ce qui sera supprimé'}</button></div>
        </form>
      )}

      {status.enabled && step === 'confirm' && prev && (
        <form onSubmit={execute} className="mt-6 space-y-5">
          <h3 className="text-lg font-bold">3. Dernière vérification</h3>
          <div className="rounded-xl bg-bad/10 p-4">
            <p className="font-bold text-bad">Seront supprimés définitivement :</p>
            <ul className="mt-2 space-y-1 text-base">{prev.counts.map((c) => <li key={c.label} className="flex justify-between"><span>{c.label}</span><strong>{c.n.toLocaleString('fr-FR')}</strong></li>)}</ul>
          </div>
          <label className="flex items-start gap-3 text-base"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ack1} onChange={(e) => setAck1(e.target.checked)} />Je comprends que cette suppression est irréversible.</label>
          <label className="flex items-start gap-3 text-base"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={ack2} onChange={(e) => setAck2(e.target.checked)} />Je confirme que ces données ne sont que des données de test, ou qu’elles sont sauvegardées.</label>
          <div><label htmlFor="ph" className="label">Recopiez exactement : <strong className="select-none text-bad">{needed}</strong></label>
            <input id="ph" className="field" value={phrase} onChange={(e) => setPhrase(e.target.value)} autoComplete="off" spellCheck={false} onPaste={(e) => e.preventDefault()} /></div>
          <div><label htmlFor="p2" className="label">Ressaisissez votre mot de passe</label>
            <PasswordInput id="p2" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="current-password" /></div>
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="flex items-center justify-between gap-3">
            <button type="button" className="btn-ghost btn-sm" onClick={reset}>Annuler</button>
            <button className="btn-primary !bg-bad" disabled={busy || !ready}>{busy ? 'Suppression…' : left > 0 ? `Patientez ${left} s` : 'Supprimer définitivement'}</button>
          </div>
          <p className="text-sm text-ink-soft">Cette demande expire après {Math.round(prev.expiresInSec / 60)} minutes.</p>
        </form>
      )}

      {step === 'done' && (
        <div className="mt-6 space-y-4">
          <p className="rounded-xl bg-ok/10 p-4 text-base font-medium text-ok">Données supprimées.</p>
          <ul className="space-y-1 text-base">{result.map((c) => <li key={c.label} className="flex justify-between"><span>{c.label}</span><strong>{c.n.toLocaleString('fr-FR')}</strong></li>)}</ul>
          <button className="btn-ghost btn-sm" onClick={reset}>Terminer</button>
        </div>
      )}
    </div>
  )
}
