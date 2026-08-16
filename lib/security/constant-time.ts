import { timingSafeEqual } from 'crypto'

/**
 * Constant-time string comparison — avoids leaking how many leading characters of a guessed
 * secret matched via response timing. Use for every shared-secret/bearer-token check; never `===`.
 *
 * One definition, one place: `app/api/health-connect/ingest/route.ts` and
 * `app/api/admin/day-review/route.ts` both compare a caller-supplied secret and must not drift
 * into subtly different implementations.
 */
export function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA) // keep timing constant regardless of length mismatch
    return false
  }
  return timingSafeEqual(bufA, bufB)
}
