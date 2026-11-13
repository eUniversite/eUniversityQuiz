import crypto from 'node:crypto'
import express, { type Request, type RequestHandler, type Response } from 'express'
import jwt from 'jsonwebtoken'
import { config } from './config.js'
import { prisma } from './db.js'
import { entitlementsOf } from './billing/index.js'
import { RateLimiter } from './security.js'

type AH = (fn: (req: Request, res: Response) => Promise<unknown>) => RequestHandler

const TOKEN_TTL = 3600
const CODE_TTL_MS = 60_000
const sha = (v: string) => crypto.createHash('sha256').update(v).digest('hex')
const tokenLimiter = new RateLimiter(60, 60_000)

// Clé de signature (RS256). Sans SSO_PRIVATE_KEY, une clé éphémère est créée : les jetons ne survivent pas à un redémarrage.
const privateKey = config.ssoPrivateKey ? crypto.createPrivateKey(config.ssoPrivateKey) : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const publicKey = crypto.createPublicKey(privateKey)
const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey
const kid = sha(JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })).slice(0, 16)
if (config.prod && config.ssoClients.length && !config.ssoPrivateKey) console.warn('[sso] SSO_PRIVATE_KEY absente : clé éphémère utilisée.')

const issuer = () => config.publicUrl
const client = (id: unknown) => config.ssoClients.find((c) => c.id === id)
const safeEq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y) }
const oauthError = (res: Response, status: number, error: string, description?: string) => res.status(status).json({ error, ...(description ? { error_description: description } : {}) })

/**
 * Fournisseur d'identité OpenID Connect (flux « authorization code » + PKCE) pour les autres applications eUniversité.
 * L'écran de connexion est la page web /sso/connexion : elle appelle POST /sso/authorize une fois l'étudiant connecté.
 */
export function buildSsoRouter(requireStudent: RequestHandler, ah: AH) {
  const r = express.Router()

  r.get('/.well-known/openid-configuration', (_req, res) => {
    const base = issuer()
    res.json({
      issuer: base, authorization_endpoint: `${base}/sso/connexion`, token_endpoint: `${base}/api/sso/token`,
      userinfo_endpoint: `${base}/api/sso/userinfo`, jwks_uri: `${base}/api/sso/jwks.json`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code'], subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'], scopes_supported: ['openid', 'email', 'profile'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    })
  })
  r.get('/jwks.json', (_req, res) => res.json({ keys: [{ ...jwk, kid, use: 'sig', alg: 'RS256' }] }))

  // Vérifie qu'une demande vient d'une application connue (la page de connexion affiche son nom).
  r.get('/client', (req, res) => {
    const c = client(req.query.client_id)
    if (!c || !c.redirectUris.includes(String(req.query.redirect_uri))) return res.status(400).json({ error: 'Application inconnue.' })
    res.json({ name: (c as { name?: string }).name ?? c.id })
  })

  // Étape appelée par la page de connexion, étudiant authentifié : émet un code à usage unique et renvoie l'URL de retour.
  r.post('/authorize', requireStudent, ah(async (req, res) => {
    const b = req.body ?? {}
    const c = client(b.client_id)
    if (!c || !c.redirectUris.includes(b.redirect_uri)) return res.status(400).json({ error: 'Application ou adresse de retour non autorisée.' })
    if (b.code_challenge && b.code_challenge_method !== 'S256') return res.status(400).json({ error: 'PKCE : seule la méthode S256 est acceptée.' })
    if (!c.secret && !b.code_challenge) return res.status(400).json({ error: 'PKCE obligatoire pour une application sans secret.' })
    const code = crypto.randomBytes(32).toString('base64url')
    await prisma.ssoCode.create({ data: {
      codeHash: sha(code), clientId: c.id, studentId: req.studentId!, redirectUri: b.redirect_uri,
      challenge: b.code_challenge ? String(b.code_challenge).slice(0, 128) : null, nonce: b.nonce ? String(b.nonce).slice(0, 200) : null, expiresAt: new Date(Date.now() + CODE_TTL_MS),
    } })
    prisma.ssoCode.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 3600_000) } } }).catch(() => {}) // ménage
    const url = new URL(b.redirect_uri)
    url.searchParams.set('code', code)
    if (b.state) url.searchParams.set('state', String(b.state).slice(0, 500))
    res.json({ redirectTo: url.toString() })
  }))

  r.post('/token', express.urlencoded({ extended: false, limit: '10kb' }), ah(async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (!tokenLimiter.hit(req.ip || '?')) return oauthError(res, 429, 'slow_down')
    const b = req.body ?? {}
    const basic = /^Basic (.+)$/.exec(req.headers.authorization ?? '')
    const [bid, bsecret] = basic ? Buffer.from(basic[1], 'base64').toString().split(/:(.*)/s).map(decodeURIComponent) : []
    const clientId = bid ?? b.client_id, secret = bsecret ?? b.client_secret
    const c = client(clientId)
    if (!c || (c.secret && !(typeof secret === 'string' && safeEq(secret, c.secret)))) return oauthError(res, 401, 'invalid_client')
    if (b.grant_type !== 'authorization_code' || typeof b.code !== 'string') return oauthError(res, 400, 'unsupported_grant_type')

    const row = await prisma.ssoCode.findUnique({ where: { codeHash: sha(b.code) } })
    if (!row || row.clientId !== c.id || row.redirectUri !== b.redirect_uri || row.expiresAt < new Date() || row.usedAt) return oauthError(res, 400, 'invalid_grant')
    if (row.challenge) {
      const v = typeof b.code_verifier === 'string' ? crypto.createHash('sha256').update(b.code_verifier).digest('base64url') : ''
      if (!safeEq(v, row.challenge)) return oauthError(res, 400, 'invalid_grant', 'PKCE invalide.')
    }
    // Usage unique : un seul appel gagne, même en cas de requêtes simultanées.
    if ((await prisma.ssoCode.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })).count !== 1) return oauthError(res, 400, 'invalid_grant')

    const s = await prisma.student.findUnique({ where: { id: row.studentId } })
    if (!s) return oauthError(res, 400, 'invalid_grant')
    const plan = (await entitlementsOf(s.id)).plan
    const sign = (claims: object, aud: string) => jwt.sign({ ...claims }, privateKey, { algorithm: 'RS256', keyid: kid, issuer: issuer() || 'euniversity', audience: aud, subject: s.id, expiresIn: TOKEN_TTL })
    res.json({
      token_type: 'Bearer', expires_in: TOKEN_TTL,
      access_token: sign({ scope: 'openid email profile' }, 'euniversity:userinfo'),
      id_token: sign({ email: s.email, email_verified: true, name: s.name, plan, ...(row.nonce ? { nonce: row.nonce } : {}) }, c.id),
    })
  }))

  r.get('/userinfo', ah(async (req, res) => {
    try {
      const t = jwt.verify((req.headers.authorization ?? '').replace(/^Bearer /, ''), publicKey, { algorithms: ['RS256'], audience: 'euniversity:userinfo', issuer: issuer() || 'euniversity' }) as jwt.JwtPayload
      const s = await prisma.student.findUnique({ where: { id: String(t.sub) } })
      if (!s) throw new Error('inconnu')
      res.json({ sub: s.id, email: s.email, email_verified: true, name: s.name, plan: (await entitlementsOf(s.id)).plan })
    } catch { res.status(401).set('WWW-Authenticate', 'Bearer error="invalid_token"').json({ error: 'invalid_token' }) }
  }))

  return r
}
