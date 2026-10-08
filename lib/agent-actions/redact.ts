/**
 * #2381 — what an agent action may record about its own parameters (`agent_action_log.parameters`).
 *
 * The log is read through `claude_ro` by every agent, and a row outlives the account it ran on. So a
 * secret must never reach it, whichever route forgot to strip one. This runs inside the repository
 * write (`startAgentAction`), not at each call site, so a new route cannot skip it.
 *
 * It drops, at any depth, every key whose NAME suggests a credential. It matches broadly on purpose:
 * dropping a harmless `keyDate` costs a less detailed log entry, while keeping an `apiKey` would put
 * a credential in the log. It cannot recognise personal data by value, so writers still pass only
 * ids, dates, table names and flags (see the migration header).
 */
export const SENSITIVE_PARAMETER_KEY = /secret|token|key|passw|authori[sz]ation|cookie|credential|bearer|signature/i

/** Deeper than any real parameter object; anything below it is dropped rather than walked. */
const MAX_DEPTH = 8

function clean(value: unknown, depth: number): unknown {
  if (Array.isArray(value)) {
    return depth >= MAX_DEPTH ? [] : value.map(v => clean(v, depth + 1))
  }
  if (value !== null && typeof value === 'object') {
    if (depth >= MAX_DEPTH) return {}
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_PARAMETER_KEY.test(k)) continue
      // JSON has no undefined; leaving one in would make the stored object differ from the input.
      if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue
      out[k] = clean(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'bigint') return value.toString()
  return value
}

/** A copy of `parameters` without any key that names a credential. Never mutates its input. */
export function redactActionParameters(parameters: Record<string, unknown> | null | undefined): Record<string, unknown> {
  if (parameters == null) return {}
  return clean(parameters, 0) as Record<string, unknown>
}
