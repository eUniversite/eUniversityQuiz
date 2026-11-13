const KEY = 'euniv:teacher'
export const teacherToken = () => localStorage.getItem(KEY)
export const setTeacherToken = (t: string | null) => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY))

const AKEY = 'euniv:admin'
export const adminToken = () => localStorage.getItem(AKEY)
export const setAdminToken = (t: string | null) => (t ? localStorage.setItem(AKEY, t) : localStorage.removeItem(AKEY))

const SKEY = 'euniv:student'
export const studentToken = () => localStorage.getItem(SKEY)
export const setStudentToken = (t: string | null) => (t ? localStorage.setItem(SKEY, t) : localStorage.removeItem(SKEY))

/** Profil connecté sur cet appareil, d'après les jetons stockés (le serveur reste seul juge à chaque requête). */
export type Role = 'teacher' | 'student'
export const currentRole = (): Role | null => (teacherToken() ? 'teacher' : studentToken() ? 'student' : null)
export const homeFor = (role: Role | null) => (role === 'teacher' ? '/enseignant' : role === 'student' ? '/etudiant' : '/')
export function signOut() { setTeacherToken(null); setStudentToken(null) }

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: { path: string; message: string }[] = [], public code?: string) { super(message) }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; auth?: boolean; as?: Role | 'admin' } = {}): Promise<T> {
  const asStudent = opts.as === 'student'
  const asAdmin = opts.as === 'admin'
  const t = asAdmin ? adminToken() : asStudent ? studentToken() : teacherToken()
  let r: Response
  try {
    r = await fetch('/api' + path, {
      method: opts.method ?? (opts.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(opts.auth !== false && t ? { authorization: `Bearer ${t}` } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Connexion impossible. Vérifiez votre réseau et réessayez.')
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401 && opts.auth !== false && t) { if (asAdmin) { setAdminToken(null); location.href = '/admin/connexion' } else if (asStudent) { setStudentToken(null); location.href = '/connexion' } else { setTeacherToken(null); location.href = '/enseignant/connexion' } }
    throw new ApiError(r.status, j.error || 'Une erreur est survenue.', j.fields, j.code)
  }
  return j
}

let cfg: Promise<{ publicUrl: string }> | null = null
export async function joinUrl(code: string) {
  cfg ??= api('/config', { auth: false }).catch(() => ({ publicUrl: '' }))
  const { publicUrl } = await cfg
  return `${publicUrl || location.origin}/j/${code}`
}

/** Import d'un cours (multipart) pour Study. Renvoie l'identifiant du cours à suivre. */
export async function uploadCourse(file: File): Promise<{ id: string; truncated: boolean }> {
  const form = new FormData()
  form.append('file', file)
  let r: Response
  try { r = await fetch('/api/study/courses', { method: 'POST', headers: { authorization: `Bearer ${studentToken() ?? ''}` }, body: form }) }
  catch { throw new ApiError(0, 'Connexion impossible. Vérifiez votre réseau et réessayez.') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    if (r.status === 401) { setStudentToken(null); location.href = '/connexion' }
    throw new ApiError(r.status, j.error || 'Import impossible.', [], j.code)
  }
  return j
}
