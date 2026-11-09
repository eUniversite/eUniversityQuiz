import { config } from '../config.js'

/** Erreur dont le message peut être montré tel quel à l'étudiant. */
export class StudyError extends Error {
  /** true = panne passagère du service (surcharge, réseau) : la file de tâches réessaiera plus tard. */
  constructor(message: string, readonly retryable = false) { super(message) }
}

type Schema = Record<string, unknown>

/**
 * Appel Gemini avec sortie JSON contrainte par un schéma.
 * C'est la seule fonction qui parle au modèle : le modèle auto-hébergé n'aura qu'à remplacer celle-ci.
 * La clé voyage dans un en-tête (jamais dans l'URL) et n'est jamais journalisée, pas plus que le contenu des cours.
 */
export async function generateJson<T>(opts: { system: string; user: string; schema: Schema; temperature?: number }): Promise<T> {
  if (!config.geminiApiKey) throw new StudyError('La génération de quiz n’est pas configurée sur ce serveur (clé du modèle manquante).')
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: 'user', parts: [{ text: opts.user }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: opts.schema, temperature: opts.temperature ?? 0.3 },
  })

  // Modèle principal, puis modèles de secours : un modèle surchargé (429/5xx), injoignable ou retiré (404) passe la main au suivant.
  const models = [config.geminiModel, ...config.geminiFallbackModels].filter((m, i, a) => m && a.indexOf(m) === i)
  let lastStatus = 0
  let lastErr = ''
  for (const model of models) {
    const url = `${config.geminiBase}/models/${encodeURIComponent(model)}:generateContent`
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2500))
      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiApiKey }, body, signal: AbortSignal.timeout(120_000) })
      } catch (e) { lastStatus = 0; lastErr = String((e as any)?.cause?.code ?? (e as Error)?.name ?? e); continue }
      lastStatus = res.status
      if (res.status === 404) break                                  // modèle retiré : on passe au suivant
      if (res.status === 429 || res.status >= 500) continue         // surcharge : on réessaie, puis on passe au suivant
      if (res.status === 401 || res.status === 403) throw new StudyError('Le service de génération a refusé la requête (clé invalide ou non autorisée).')
      if (!res.ok) throw new StudyError('Le service de génération a répondu par une erreur. Réessayez dans un moment.')
      const j: any = await res.json().catch(() => null)
      const cand = j?.candidates?.[0]
      const text = cand?.content?.parts?.map((p: any) => p?.text ?? '').join('')
      if (!text) throw new StudyError(cand?.finishReason === 'SAFETY' ? 'Le contenu a été bloqué par le service de génération.' : 'Le service de génération n’a rien renvoyé. Réessayez.')
      try { return JSON.parse(text) as T } catch { throw new StudyError('La réponse du modèle est illisible. Réessayez.') }
    }
    console.warn(`study: modèle ${model} indisponible (HTTP ${lastStatus}${lastErr ? ' ' + lastErr : ''}), essai du suivant`)
  }
  throw new StudyError(lastStatus === 429 || lastStatus === 503 ? 'Le service de génération est très sollicité en ce moment. Réessayez dans quelques minutes.' : 'Le service de génération est injoignable. Réessayez plus tard.', true)
}

// Schémas de sortie (sous-ensemble OpenAPI attendu par Gemini)
const str = { type: 'STRING' }
export const ANALYSE_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    usable: { type: 'BOOLEAN' },
    unusableReason: str,
    title: str,
    summary: str,
    missions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          title: str,
          startPage: { type: 'INTEGER' },
          endPage: { type: 'INTEGER' },
          notions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { label: str, page: { type: 'INTEGER' }, excerpt: str }, required: ['label', 'page', 'excerpt'] } },
        },
        required: ['title', 'startPage', 'endPage', 'notions'],
      },
    },
  },
  required: ['usable', 'title', 'summary', 'missions'],
}

export const CREATE_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          notionIndex: { type: 'INTEGER' },
          level: { type: 'INTEGER' },
          question: str,
          choices: { type: 'ARRAY', items: str },
          answerIndex: { type: 'INTEGER' },
          explanation: str,
          sourcePage: { type: 'INTEGER' },
          sourceExcerpt: str,
        },
        required: ['notionIndex', 'level', 'question', 'choices', 'answerIndex', 'explanation', 'sourcePage', 'sourceExcerpt'],
      },
    },
  },
  required: ['questions'],
}

// Relecture indépendante : le modèle répond lui-même à chaque question à partir du cours, sans voir la réponse attendue.
export const VERIFY_SCHEMA: Schema = {
  type: 'OBJECT',
  properties: {
    results: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { index: { type: 'INTEGER' }, answerIndex: { type: 'INTEGER' }, supported: { type: 'BOOLEAN' }, ambiguous: { type: 'BOOLEAN' }, note: str },
        required: ['index', 'answerIndex', 'supported', 'ambiguous'],
      },
    },
  },
  required: ['results'],
}
