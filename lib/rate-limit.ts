import { getPool, ensureSchema } from '@/lib/data/postgres/client'

// Two-tier rate limiter. The in-memory map is a synchronous L1 fast path so
// the public API stays `(key, limit, windowMs) => boolean`; the rate_limits
// Postgres table (migration 104) is the authoritative shared store — its
// count is written back into the L1 entry after each background flush, so a
// count built up on another replica (or before a deploy restart) starts
// denying from the next call. Accepted lag: a cold replica can let a few
// requests through before the first DB round-trip lands. If the DB is
// unreachable the limiter degrades to today's memory-only behaviour.

interface Entry { count: number; resetAt: number }

const store = new Map<string, Entry>()
let lastPruneTime = Date.now()
let lastDbPrune = 0
let dbDisabledUntil = 0

const pendingIncrements = new Map<string, number>()
const keysInFlight = new Set<string>()
const inFlightFlushes = new Set<Promise<void>>()

const UPSERT_SQL = `
  INSERT INTO rate_limits (key, count, window_start)
  VALUES ($1, $2, now())
  ON CONFLICT (key) DO UPDATE SET
    count = CASE
      WHEN rate_limits.window_start <= now() - make_interval(secs => $3::double precision)
      THEN excluded.count
      ELSE rate_limits.count + excluded.count
    END,
    window_start = CASE
      WHEN rate_limits.window_start <= now() - make_interval(secs => $3::double precision)
      THEN now()
      ELSE rate_limits.window_start
    END
  RETURNING count, (extract(epoch FROM window_start) * 1000)::bigint AS window_start_ms
`

function pruneExpired() {
  const now = Date.now()
  if (now - lastPruneTime < 5 * 60 * 1000) return
  for (const [key, entry] of store.entries()) {
    if (entry.resetAt < now) store.delete(key)
  }
  lastPruneTime = now
}

async function flushKey(key: string, increments: number, windowMs: number): Promise<void> {
  await ensureSchema()
  const { rows } = await getPool().query(UPSERT_SQL, [key, increments, windowMs / 1000])
  const dbCount = Number(rows[0].count)
  const windowStartMs = Number(rows[0].window_start_ms)
  const entry = store.get(key)
  if (entry) {
    // DB is authoritative; never lower below local (unflushed local increments).
    entry.count = Math.max(entry.count, dbCount)
    entry.resetAt = windowStartMs + windowMs
  }
  const now = Date.now()
  if (now - lastDbPrune > 60 * 60 * 1000) {
    lastDbPrune = now
    getPool().query(`DELETE FROM rate_limits WHERE window_start < now() - interval '2 days'`).catch(() => {})
  }
}

function scheduleFlush(key: string, windowMs: number): void {
  if (Date.now() < dbDisabledUntil) return
  pendingIncrements.set(key, (pendingIncrements.get(key) ?? 0) + 1)
  if (keysInFlight.has(key)) return
  keysInFlight.add(key)
  const p = (async () => {
    try {
      while ((pendingIncrements.get(key) ?? 0) > 0) {
        const n = pendingIncrements.get(key)!
        pendingIncrements.delete(key)
        await flushKey(key, n, windowMs)
      }
    } catch (err) {
      // DB unreachable — degrade to memory-only for 30s to avoid hammering.
      dbDisabledUntil = Date.now() + 30_000
      console.warn('[rate-limit] shared store unavailable, memory-only:', String(err).slice(0, 120))
    } finally {
      keysInFlight.delete(key)
    }
  })()
  inFlightFlushes.add(p)
  p.finally(() => inFlightFlushes.delete(p))
}

/**
 * Returns true if the request is allowed, false if rate-limited.
 * @param key    Unique key (e.g. "register:1.2.3.4" or "login:user@email.com")
 * @param limit  Max attempts allowed within the window
 * @param windowMs  Window duration in milliseconds
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  pruneExpired()
  const now = Date.now()
  let entry = store.get(key)
  if (!entry || now > entry.resetAt) {
    if (entry) store.delete(key)
    entry = { count: 0, resetAt: now + windowMs }
    store.set(key, entry)
  }
  if (entry.count >= limit) return false
  entry.count++
  scheduleFlush(key, windowMs)
  return true
}

// ── Test hooks ────────────────────────────────────────────────────────────
export async function _awaitRateLimitFlushes(): Promise<void> {
  while (inFlightFlushes.size > 0) await Promise.all([...inFlightFlushes])
}

export function _resetRateLimitL1(): void {
  store.clear()
  pendingIncrements.clear()
  dbDisabledUntil = 0
  lastDbPrune = 0
}
