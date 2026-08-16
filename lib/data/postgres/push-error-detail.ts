import type { ZodError } from 'zod'

// A rejected mutation dead-letters after 5 attempts and the owner sees only the message we put
// here. "Invalid activity_logs payload" cost a whole session to trace to segments[0].avgHr
// (2026-08-02) — name the field. Capped so it stays readable in the sync-health card.
export function describeZodFailure(error: ZodError): string {
  return error.issues
    .slice(0, 3)
    .map(i => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ')
    .slice(0, 200)
}
