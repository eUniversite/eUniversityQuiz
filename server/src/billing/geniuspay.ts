import crypto from 'node:crypto'
import { config } from '../config.js'

export class GatewayError extends Error {}

/** API GeniusPay v2 (https://api.geniuspay.ci/v2) : clé secrète sk_… en « Bearer ». */
const headers = (): Record<string, string> => ({
  Authorization: `Bearer ${config.geniuspaySecret}`,
  Accept: 'application/json',
  'Content-Type': 'application/json',
})

export interface CheckoutInput {
  amount: number
  reference: string
  description: string
  customer: { name: string; email: string }
  successUrl: string
  errorUrl: string
  metadata: Record<string, string>
}

/** Message d'erreur lisible, quelle que soit la forme renvoyée (« error » texte ou objet, « message »). */
const errorText = (j: any): string | undefined => {
  const e = j?.error
  return (typeof e === 'string' ? e : e?.message) || j?.message || undefined
}

/** Client GeniusPay. Objet exporté tel quel pour pouvoir le remplacer dans les tests. */
export const gateway = {
  configured: () => !!config.geniuspaySecret,

  /** Crée un paiement « checkout hébergé » : le client choisit son moyen de paiement chez GeniusPay (lien valable 15 minutes). */
  async createCheckout(p: CheckoutInput): Promise<{ checkoutUrl: string; gatewayRef: string }> {
    const body = { reference: p.reference, amount: p.amount, currency: 'XOF', country_code: 'CI', idempotency_key: p.reference, success_url: p.successUrl, cancel_url: p.errorUrl, customer_email: p.customer.email, metadata: { ...p.metadata, description: p.description, customer_name: p.customer.name } }
    const res = await fetch(`${config.geniuspayBase}/payments/initiate`, {
      method: 'POST',
      headers: { ...headers(), 'Idempotency-Key': p.reference },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => { throw new GatewayError('Le service de paiement ne répond pas. Réessayez dans un instant.') })
    const j: any = await res.json().catch(() => ({}))
    const d = j?.data ?? j
    const checkoutUrl = d?.checkout_url
    // v2 : transaction_id / public_reference ; à défaut, notre propre référence (elle identifie aussi le paiement chez GeniusPay).
    const gatewayRef = d?.reference ?? d?.transaction_id ?? d?.id ?? d?.public_reference ?? p.reference
    if (!res.ok || !checkoutUrl || !gatewayRef) throw new GatewayError(errorText(j) || `Paiement refusé par GeniusPay (HTTP ${res.status}).`)
    return { checkoutUrl, gatewayRef: String(gatewayRef) }
  },

  /** Statut d'un paiement chez GeniusPay (`pending`, `completed`, `failed`, `cancelled`…), ou null si indisponible. */
  async fetchStatus(p: { reference: string }): Promise<string | null> {
    // « id » accepte notre propre référence.
    const res = await fetch(`${config.geniuspayBase}/payments/${encodeURIComponent(p.reference)}/status`, { headers: headers(), signal: AbortSignal.timeout(20_000) }).catch(() => null)
    if (!res?.ok) return null
    const j: any = await res.json().catch(() => ({}))
    const status = j?.data?.status ?? j?.status
    return typeof status === 'string' ? status : null
  },
}

const isLoopback = (ip?: string) => !!ip && (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.'))

/**
 * Signature du webhook : HMAC-SHA256 de « <timestamp>.<corps brut> » avec le secret whsec_…
 * En-têtes : X-GeniusPay-Signature = « t=<timestamp>,v1=<signature> » et X-GeniusPay-Timestamp (identique à t).
 */
export function verifyWebhookSignature(raw: Buffer | string, signature: string | undefined, timestamp: string | undefined, ip?: string): boolean {
  const secret = config.geniuspayWebhookSecret
  // Sans secret : toléré uniquement en développement ET pour un appel venant de cette machine (jamais depuis Internet).
  if (!secret) return !config.prod && isLoopback(ip)
  if (!signature || !timestamp) return false

  if (!signature.includes('v1=')) return false
  const parts = new Map(signature.split(',').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const }))
  if (parts.get('t') !== timestamp) return false
  const t = parts.get('t') ?? '', sig = parts.get('v1') ?? ''
  const ts = Number(t)
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(sig)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
