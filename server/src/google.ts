import { createPublicKey } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

export interface GoogleProfile { sub: string; email: string; name: string }

const CERTS = 'https://www.googleapis.com/oauth2/v3/certs'
let cache: { at: number; keys: (JsonWebKey & { kid?: string })[] } | null = null

async function keys() {
  if (cache && Date.now() - cache.at < 3600_000) return cache.keys
  const res = await fetch(CERTS, { signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error('Certificats Google indisponibles.')
  cache = { at: Date.now(), keys: ((await res.json()) as { keys: (JsonWebKey & { kid?: string })[] }).keys }
  return cache.keys
}

/** Vérifie le jeton d'identité renvoyé par « Se connecter avec Google » (signature, audience, émetteur, e-mail vérifié). */
export const googleVerifier = {
  enabled: () => !!config.googleClientId,
  async verify(credential: string): Promise<GoogleProfile> {
    const header = jwt.decode(credential, { complete: true })?.header
    const jwk = (await keys()).find((k) => k.kid === header?.kid)
    if (!jwk) throw new Error('Jeton Google inconnu.')
    const p = jwt.verify(credential, createPublicKey({ key: jwk, format: 'jwk' }), {
      algorithms: ['RS256'], audience: config.googleClientId, issuer: ['https://accounts.google.com', 'accounts.google.com'],
    }) as jwt.JwtPayload
    if (!p.sub || !p.email || p.email_verified !== true) throw new Error('Adresse e-mail Google non vérifiée.')
    return { sub: p.sub, email: String(p.email).toLowerCase(), name: String(p.name || '') }
  },
}
