import { extractText, getDocumentProxy } from 'unpdf'
import mammoth from 'mammoth'
import { StudyError } from './gemini.js'

export const ALLOWED = ['.pdf', '.txt', '.md', '.docx']
export const MAX_CHARS = 150_000
const SECTION = 2500

export interface Extracted { pages: string[]; unit: 'page' | 'section'; truncated: boolean }

/** Découpe un long texte en « sections » d'environ 2 500 caractères, à la frontière d'un paragraphe. */
function toSections(text: string): string[] {
  const out: string[] = []
  let cur = ''
  for (const para of text.split(/\n{2,}/)) {
    if (cur && cur.length + para.length > SECTION) { out.push(cur); cur = '' }
    cur += (cur ? '\n\n' : '') + para
  }
  if (cur.trim()) out.push(cur)
  return out
}

const clean = (t: string) => t.replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()

/** Extrait le texte d'un fichier importé. Vérifie le contenu réel (pas seulement l'extension). */
export async function extractDocument(buf: Buffer, fileName: string): Promise<Extracted> {
  const ext = (fileName.toLowerCase().match(/\.[a-z0-9]+$/)?.[0]) ?? ''
  if (!ALLOWED.includes(ext)) throw new StudyError('Format non pris en charge. Importez un PDF, un DOCX, un TXT ou un MD.')
  let pages: string[]
  let unit: 'page' | 'section' = 'section'

  if (ext === '.pdf') {
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new StudyError('Ce fichier n’est pas un PDF valide.')
    try {
      const pdf = await getDocumentProxy(new Uint8Array(buf))
      const r = await extractText(pdf, { mergePages: false })
      pages = (r.text as string[]).map(clean)
      unit = 'page'
    } catch { throw new StudyError('Impossible de lire ce PDF (fichier abîmé ou protégé).') }
  } else if (ext === '.docx') {
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new StudyError('Ce fichier n’est pas un document Word valide.')
    try { pages = toSections(clean((await mammoth.extractRawText({ buffer: buf })).value)) } catch { throw new StudyError('Impossible de lire ce document Word.') }
  } else {
    if (buf.includes(0)) throw new StudyError('Ce fichier n’est pas un fichier texte.')
    pages = toSections(clean(buf.toString('utf8')))
  }

  const total = pages.reduce((n, p) => n + p.length, 0)
  if (total < 300) {
    throw new StudyError(ext === '.pdf' ? 'Ce PDF ne contient presque pas de texte : il s’agit peut-être d’un scan. Les documents scannés ne sont pas encore pris en charge.' : 'Ce document contient trop peu de texte pour créer un parcours.')
  }
  // Garde-fou de taille : on garde le début du cours si le document est très long.
  let truncated = false
  if (total > MAX_CHARS) {
    truncated = true
    const kept: string[] = []
    let n = 0
    for (const p of pages) { if (n + p.length > MAX_CHARS) break; kept.push(p); n += p.length }
    pages = kept
  }
  return { pages, unit, truncated }
}
