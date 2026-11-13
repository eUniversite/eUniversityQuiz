import { z } from 'zod'
import { DURATIONS } from './config.js'

const text = (label: string, max: number) =>
  z.string({ error: `${label} : champ requis.` }).trim().min(1, `${label} : champ requis.`).max(max, `${label} : ${max} caractères maximum.`)

export const questionSchema = z.object({
  text: text('Énoncé', 500),
  options: z.array(text('Proposition', 200)).min(2, 'Au moins deux propositions.').max(4, 'Quatre propositions maximum.'),
  correctIndex: z.number().int().nullable(),
  durationSec: z.number().refine((d) => (DURATIONS as readonly number[]).includes(d), 'Durée : 10, 20, 30 ou 60 secondes.'),
  explanation: z.string().trim().max(600, 'Explication : 600 caractères maximum.').optional().nullable(),
}).refine((q) => q.correctIndex === null || (q.correctIndex >= 0 && q.correctIndex < q.options.length), { message: 'Choisissez la bonne réponse.', path: ['correctIndex'] })

export const quizSchema = z.object({
  title: text('Titre', 120),
  description: z.string().trim().max(500, 'Description : 500 caractères maximum.').optional().nullable(),
  questions: z.array(questionSchema).min(1, 'Ajoutez au moins une question.').max(100, '100 questions maximum.'),
})

const person = (label: string) => text(label, 50).refine((v) => /\p{L}/u.test(v), `${label} : lettres uniquement.`)

export const joinSchema = z.object({
  code: z.string().min(1).max(20),
  fullName: person('Nom complet'),
  nickname: z.string({ error: 'Pseudo : champ requis.' }).trim().min(2, 'Pseudo : 2 caractères minimum.').max(30, 'Pseudo : 30 caractères maximum.'),
})

const mail = () => z.string({ error: 'Adresse e-mail : champ requis.' }).trim().toLowerCase().pipe(z.string().email('Adresse e-mail invalide.').max(200))
const pw = () => z.string({ error: 'Mot de passe : champ requis.' }).min(8, 'Mot de passe : 8 caractères minimum.').max(200, 'Mot de passe : 200 caractères maximum.')

export const loginSchema = z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200) })

export const signupSchema = z.object({
  name: text('Nom complet', 100).refine((v) => v.trim().split(/\s+/).length >= 1),
  email: mail(),
  password: pw(),
  acceptedTerms: z.literal(true, { error: 'Vous devez accepter les conditions d’utilisation.' }),
})
export const studentSignupSchema = z.object({
  email: mail(),
  password: pw(),
  acceptedTerms: z.literal(true, { error: 'Vous devez accepter les conditions d’utilisation.' }),
})
export const googleLoginSchema = z.object({ credential: z.string().min(20).max(4000) })
export const checkoutSchema = z.object({ plan: z.enum(['MONTHLY', 'YEARLY'], { error: 'Choisissez une formule.' }) })

export const emailSchema = z.object({ email: mail() })
export const resetSchema = z.object({ token: z.string().min(20).max(200), password: pw() })
