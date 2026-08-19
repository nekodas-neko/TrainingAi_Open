/**
 * The client address a rate limiter may key on (Q-493).
 *
 * **The defect this replaces.** Seven routes each did
 * `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'` — the **leftmost** hop.
 * A proxy *appends* the peer it received the connection from, so the leftmost entry is whatever the
 * **caller** sent. The caller therefore chose its own rate-limit key, which defeats the gate
 * entirely. Measured on 2026-08-18 with 30 wrong-secret attempts at a limit of 20/60 s: a fixed
 * header produced **1 key at count 20** (10 attempts blocked), a rotating one produced **30 keys at
 * count 1** — every attempt reached the secret compare.
 *
 * **The rule.** Count in from the RIGHT. The rightmost entry was written by the hop nearest this
 * app and cannot be forged by the caller; each step left is one proxy further out, and only the
 * ones we actually run are trustworthy. With `trustedProxies` hops in front of the app, the client
 * is at `entries.length - trustedProxies`, and anything left of that is caller-supplied noise.
 *
 * **`trustedProxies` must match the real deployment, and being wrong is not symmetric:**
 * - **Too high** → the key is drawn from further out than reality, i.e. back into the forgeable
 *   region, and the bypass above returns.
 * - **Too low** → the key is one of our own proxies, the same constant for everybody, so every
 *   caller shares one bucket and one attacker locks out all traffic.
 *
 * Neither is silent, so it is a configured number rather than a guess: `TRUSTED_PROXY_COUNT`.
 * The default of 1 is the Railway shape (one edge proxy in front of the app).
 */

/** Hops in front of this app, from the env, defaulting to Railway's single edge proxy. */
export function trustedProxyCount(env: Record<string, string | undefined> = process.env): number {
  const raw = env.TRUSTED_PROXY_COUNT
  if (raw == null || raw === '') return 1
  const n = Number(raw)
  // A malformed value falls back to the default rather than to 0. Zero would mean "trust the
  // leftmost hop", which is exactly the bypass this module exists to close — a typo in an env var
  // must not reopen it.
  return Number.isInteger(n) && n >= 1 ? n : 1
}

/**
 * Extract the rate-limit key from an `X-Forwarded-For` value.
 *
 * Returns `'unknown'` when there is no usable header — the same fallback the call sites already
 * used, so a direct connection (local dev) behaves as before.
 */
export function clientIpFromForwardedFor(
  forwardedFor: string | null | undefined,
  trustedProxies: number = trustedProxyCount(),
): string {
  if (!forwardedFor) return 'unknown'
  const entries = forwardedFor.split(',').map(e => e.trim()).filter(Boolean)
  if (entries.length === 0) return 'unknown'

  // Clamp rather than throw. A request arriving with fewer hops than configured is a deployment
  // detail, not a caller error, and index 0 is the furthest-out entry we have.
  const index = Math.max(0, Math.min(entries.length - 1, entries.length - trustedProxies))
  return entries[index] ?? 'unknown'
}

/** Convenience for a route holding a `Request`. */
export function clientIp(req: { headers: { get(name: string): string | null } }): string {
  return clientIpFromForwardedFor(req.headers.get('x-forwarded-for'))
}
