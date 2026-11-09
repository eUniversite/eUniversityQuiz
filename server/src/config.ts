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
  mailFrom: process.env.MAIL_FROM || 'eUniversité Quiz <no-reply@euniversite.ci>',
}

export const DURATIONS = [10, 20, 30, 60] as const
// Barème : 5 points garantis par bonne réponse + bonus de rapidité jusqu'à 5
// (réponse instantanée = 10, réponse à la dernière seconde = 5).
export const BASE_POINTS = 5
export const MAX_BONUS = 5
