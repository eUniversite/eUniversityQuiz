import crypto from 'node:crypto'
import { config } from '../config.js'

export class GatewayError extends Error {}

const headers = () => ({
  'X-API-Key': config.geniuspayKey,
  'X-API-Secret': config.geniuspaySecret,
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

/** Client GeniusPay (API Marchand v1). Objet exporté tel quel pour pouvoir le remplacer dans les tests. */
export const gateway = {
  configured: () => !!(config.geniuspayKey && config.geniuspaySecret),

  /** Crée un paiement « checkout hébergé » : le client choisit son moyen de paiement chez GeniusPay. */
  async createCheckout(p: CheckoutInput): Promise<{ checkoutUrl: string; gatewayRef: string }> {
    const res = await fetch(`${config.geniuspayBase}/payments`, {
      method: 'POST',
      headers: { ...headers(), 'Idempotency-Key': p.reference },
      body: JSON.stringify({
        amount: p.amount, currency: 'XOF', description: p.description, external_reference: p.reference,
        success_url: p.successUrl, error_url: p.errorUrl, customer: p.customer, metadata: p.metadata,
      }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => { throw new GatewayError('Le service de paiement ne répond pas. Réessayez dans un instant.') })
    const j: any = await res.json().catch(() => ({}))
    const checkoutUrl = j?.data?.checkout_url, gatewayRef = j?.data?.reference
    if (!res.ok || !checkoutUrl || !gatewayRef) throw new GatewayError(j?.error?.message || j?.message || `Paiement refusé par GeniusPay (HTTP ${res.status}).`)
    return { checkoutUrl, gatewayRef }
  },

  /** Statut d'un paiement chez GeniusPay (`pending`, `completed`, `failed`, `cancelled`…), ou null si indisponible. */
  async fetchStatus(gatewayRef: string): Promise<string | null> {
    const res = await fetch(`${config.geniuspayBase}/payments/${encodeURIComponent(gatewayRef)}`, { headers: headers(), signal: AbortSignal.timeout(20_000) }).catch(() => null)
    if (!res?.ok) return null
    const j: any = await res.json().catch(() => ({}))
    return typeof j?.data?.status === 'string' ? j.data.status : null
  },
}

/** Signature du webhook : HMAC-SHA256 de « <X-Webhook-Timestamp>.<corps brut> » avec le secret whsec_… */
const isLoopback = (ip?: string) => !!ip && (ip === '::1' || ip === '127.0.0.1' || ip.startsWith('::ffff:127.'))

export function verifyWebhookSignature(raw: Buffer | string, signature: string | undefined, timestamp: string | undefined, ip?: string): boolean {
  const secret = config.geniuspayWebhookSecret
  // Sans secret : toléré uniquement en développement ET pour un appel venant de cette machine (jamais depuis Internet).
  if (!secret) return !config.prod && isLoopback(ip)
  if (!signature || !timestamp) return false
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest('hex')
  const a = Buffer.from(expected), b = Buffer.from(signature)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
