const prod = process.env.NODE_ENV === 'production'
const jwtSecret = process.env.JWT_SECRET || 'dev-only-secret'
if (prod && (jwtSecret.length < 24 || jwtSecret.startsWith('change-me'))) {
  throw new Error('JWT_SECRET doit être défini avec une valeur longue et aléatoire en production.')
}

export const config = {
  prod,
  port: Number(process.env.PORT || 3100),
  jwtSecret,
  publicUrl: process.env.PUBLIC_URL || '',
  corsOrigins: (process.env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: process.env.TRUST_PROXY === '1',
  // Surchargeable par les tests de charge / tests automatisés.
  disableRateLimit: process.env.DISABLE_RATE_LIMIT === '1',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: process.env.SMTP_SECURE === '1',
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  // Study : génération de quiz par LLM (Gemini pour les essais ; le modèle auto-hébergé reprendra la même interface).
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-3.5-flash',
  geminiFallbackModels: (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.1-flash-lite').split(',').map((s) => s.trim()).filter(Boolean),
  geminiBase: process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta',
  studyQuestions: Number(process.env.STUDY_QUESTIONS || 8),
  studyMaxUploadMb: Number(process.env.STUDY_MAX_UPLOAD_MB || 10),
  // Plan Découverte (compte sans abonnement) : fichier, nombre de cours et missions jouables par cours.
  freeUploadMb: Number(process.env.FREE_UPLOAD_MB || 2),
  freeCourses: Number(process.env.FREE_COURSES || 1),
  freeMissions: Number(process.env.FREE_MISSIONS || 3),
  // Premier administrateur, créé au démarrage quand on n'a pas de terminal (Coolify). Ignoré une fois le compte créé, sauf ADMIN_BOOTSTRAP_RESET=1.
  adminBootstrapEmail: (process.env.ADMIN_BOOTSTRAP_EMAIL || '').trim().toLowerCase(),
  adminBootstrapPassword: process.env.ADMIN_BOOTSTRAP_PASSWORD || '',
  adminBootstrapReset: process.env.ADMIN_BOOTSTRAP_RESET === '1',
  // Connexion Google (identifiant client OAuth « Web » de la console Google Cloud).
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  // SSO interne : eUniversity fournit l'identité (OpenID Connect) aux autres applications eUniversité.
  // SSO_CLIENTS = [{"id":"activate","secret":"…","redirectUris":["https://…/callback"]}] ; SSO_PRIVATE_KEY = clé RSA PEM (« \n » accepté).
  ssoClients: (() => { try { return JSON.parse(process.env.SSO_CLIENTS || '[]') as { id: string; secret?: string; redirectUris: string[] }[] } catch { return [] } })(),
  ssoPrivateKey: (process.env.SSO_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  // Abonnement Study : paiement GeniusPay (clés sandbox pk_sandbox_… / sk_sandbox_…, puis pk_live_… / sk_live_…).
  geniuspayKey: process.env.GENIUSPAY_API_KEY || '',
  geniuspaySecret: process.env.GENIUSPAY_API_SECRET || '',
  geniuspayWebhookSecret: process.env.GENIUSPAY_WEBHOOK_SECRET || '',
  geniuspayBase: (process.env.GENIUSPAY_BASE_URL || 'https://geniuspay.ci/api/v1/merchant').replace(/\/+$/, ''),
  // Polling de secours : délai laissé au webhook (secondes) après le retour de l'étudiant, puis s'il n'est jamais revenu.
  billingWebhookGrace: Number(process.env.BILLING_WEBHOOK_GRACE ?? 30),
  billingUnreturnedAfter: Number(process.env.BILLING_UNRETURNED_AFTER ?? 600),
  mailFrom: process.env.MAIL_FROM || 'eUniversité Quiz <no-reply@euniversite.ci>',
}

export const DURATIONS = [10, 20, 30, 60] as const
// Barème : 5 points garantis par bonne réponse + bonus de rapidité jusqu'à 5
// (réponse instantanée = 10, réponse à la dernière seconde = 5).
export const BASE_POINTS = 5
export const MAX_BONUS = 5
