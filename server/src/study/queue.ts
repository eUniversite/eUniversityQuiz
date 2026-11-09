import { Prisma } from '@prisma/client'
import { prisma } from '../db.js'
import { StudyError } from './gemini.js'
import { processCourse } from './pipeline.js'

// File de tâches Study, stockée dans PostgreSQL : un cours en attente survit à un redémarrage du serveur.
// Un « worker » (cette boucle) prend le plus ancien cours QUEUED et le traite ; FOR UPDATE SKIP LOCKED permet de lancer
// plusieurs serveurs sans que deux traitent le même cours.
const MAX_ATTEMPTS = 3
const STALE_MS = 10 * 60_000        // un travail sans signe de vie depuis 10 min est repris
const POLL_MS = 2000

let busy = false
let timer: NodeJS.Timeout | null = null

async function claim(): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "StudyCourse" SET status = 'ANALYSING', "lockedAt" = now(), attempts = attempts + 1, error = NULL, progress = 0, step = 'Démarrage'
    WHERE id = (SELECT id FROM "StudyCourse" WHERE status = 'QUEUED' AND ("runAfter" IS NULL OR "runAfter" <= now()) ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED)
    RETURNING id`
  return rows[0]?.id ?? null
}

/** Remet en file les travaux restés « en cours » sans signe de vie (serveur arrêté ou bloqué) ; échoue ceux qui n'ont plus de texte ou plus d'essais. */
async function recover(all: boolean) {
  const stuck = await prisma.studyCourse.findMany({
    where: { status: { in: ['EXTRACTING', 'ANALYSING', 'CREATING'] }, ...(all ? {} : { lockedAt: { lt: new Date(Date.now() - STALE_MS) } }) },
    select: { id: true, attempts: true, sourceText: true },
  })
  for (const c of stuck) {
    if (c.sourceText && c.attempts < MAX_ATTEMPTS) {
      await prisma.studyCourse.update({ where: { id: c.id }, data: { status: 'QUEUED', step: 'En attente', runAfter: null } })
    } else {
      await prisma.studyCourse.update({ where: { id: c.id }, data: { status: 'FAILED', error: 'La création a été interrompue. Importez à nouveau le cours.', sourceText: Prisma.DbNull, step: null } })
    }
  }
}

async function runOne(id: string) {
  try {
    await processCourse(id)
  } catch (e) {
    const known = e instanceof StudyError
    if (!known) console.error('study job:', (e as Error).message)
    const c = await prisma.studyCourse.findUnique({ where: { id }, select: { attempts: true } })
    if (known && e.retryable && (c?.attempts ?? MAX_ATTEMPTS) < MAX_ATTEMPTS) {
      // Panne passagère du modèle : on repasse en file, avec une attente qui s'allonge.
      const wait = 45_000 * (c?.attempts ?? 1)
      await prisma.studyCourse.update({ where: { id }, data: { status: 'QUEUED', step: 'Service très sollicité, nouvel essai bientôt', runAfter: new Date(Date.now() + wait) } }).catch(() => {})
      return
    }
    const msg = known ? e.message : 'Une erreur est survenue pendant la création du parcours. Réessayez.'
    await prisma.studyCourse.update({ where: { id }, data: { status: 'FAILED', error: msg, step: null, progress: 0, sourceText: Prisma.DbNull } }).catch(() => {})
  }
}

export async function tick() {
  if (busy) return
  busy = true
  try {
    await recover(false)
    for (let id = await claim(); id; id = await claim()) await runOne(id)
  } catch (e) {
    console.error('study queue:', (e as Error).message)
  } finally { busy = false }
}

/** À appeler une fois au démarrage du serveur (une seule instance : tout ce qui était « en cours » est repris). */
export async function startStudyWorker() {
  await recover(true).catch((e) => console.error('study recover:', (e as Error).message))
  timer = setInterval(() => void tick(), POLL_MS)
  timer.unref()
  void tick()
}

export function stopStudyWorker() { if (timer) clearInterval(timer); timer = null }
/** Réveille la file tout de suite (après un import) au lieu d'attendre le prochain passage. */
export const wakeStudyWorker = () => void tick()
