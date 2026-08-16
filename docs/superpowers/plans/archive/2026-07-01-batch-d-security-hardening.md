# Batch D — Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden the security posture per Batch D of `docs/planned_upgrades.md`: bind the mobile-auth deep-link token to a PKCE verifier so an interceptor app can't redeem it (D2); make the rate limiter survive deploys and span replicas with a Postgres-backed shared store while keeping the sync `rateLimit(key, limit, windowMs)` signature (D3); bound builder-chat's `program: z.any()` (also fixing its 500 on malformed input) (D3); add an Oura OAuth `state` param via a signed cookie, guard nutrition/scan's body parse before `req.json()`, clamp AI-chat weight writes and body-metadata POST numbers, enforce CSP, and return proper 403s from admin routes (D4); allowlist + URL-encode `fetchDocumentById` and regression-test inactive-by-default registration (D5).

**Architecture:** No new services. The rate limiter keeps its in-memory `Map` as a synchronous L1 fast-path and adds a fire-and-forget atomic upsert into a new `rate_limits` Postgres table (migration `104_rate_limits.sql`); the DB count is written back into the L1 entry so the shared store is authoritative within one request of lag — all ~15 call sites keep `if (!rateLimit(...))` unchanged. PKCE: the Capacitor WebView (which loads the remote site per `capacitor.config.ts` `server.url`, so **no APK rebuild**) generates a verifier, stores it in its own `localStorage`, and passes the SHA-256 challenge through `/mobile-signin` → next-auth `callbackUrl` → `/auth-mobile-bridge`; the server stores the challenge with the one-time token and `exchange-mobile-token` refuses to redeem without the matching verifier. Oura CSRF state rides a short-lived HS256 JWT (jose, signed with `AUTH_SECRET`) in an httpOnly cookie. Validation logic (PKCE, state, clamps, body-limit, mime allowlist, program schema) lives in small pure modules under `lib/` with vitest unit tests mirroring the existing `lib/**/__tests__/*.test.ts` style (`pnpm test` = `vitest run`, `@` alias configured in `vitest.config.ts`).

**Tech Stack:** Next.js 15 App Router route handlers, next-auth v5 beta, `pg` Pool (`lib/data/postgres/client.ts` `getPool`/`ensureSchema`), Drizzle only where already used, zod v4, jose v6, Node `crypto`, vitest 4, pnpm.

---

## Scope exclusions (deliberate — do NOT implement here)

- **D1 — Oura webhook fail-closed** (reject when signature header or signing key missing): in the **quick-wins plan** (quick win 3).
- **`supplement_logs` delete `user_id` scoping in `pushMutations`** (D5): in the **quick-wins plan** (quick win 9).
- **Rate limits on `prescribe` + `session-explain/insight`**: quick win 6 (those routes gain `rateLimit()` there; this plan only upgrades the limiter's backing store — their call sites will get durability for free once both land).
- **`generateObject` migration for builder-chat/scan** (E1): Batch E. This plan only zod-bounds the *request* program, not the model output parsing.
- **`next-auth@5-beta` GA tracking** (D5): watch item, no code. Noted in Follow-ups below.
- **Android App Links** (the D2 alternative): documented as a follow-up task (Task 10) because it requires a native `AndroidManifest.xml` change + `assetlinks.json` + **APK rebuild**. The PKCE binding implemented here needs no native change.

## Manual testing setup (used by several tasks)

The local dev DB is provisioned by `scripts/local-db/setup.sh` (see CLAUDE.md). Start the server with `pnpm dev`, then authenticate curl once:

```bash
CSRF=$(curl -s -c /tmp/ta-cookies http://localhost:3000/api/auth/csrf | python3 -c 'import sys,json;print(json.load(sys.stdin)["csrfToken"])')
curl -s -b /tmp/ta-cookies -c /tmp/ta-cookies -o /dev/null -L \
  -X POST http://localhost:3000/api/auth/callback/credentials \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" \
  --data-urlencode "email=test@local.dev" \
  --data-urlencode "password=testpass123"
# All authed requests below: curl -b /tmp/ta-cookies ...
psql () { command psql postgresql://postgres:postgres@localhost:5433/trainingai_dev "$@"; }
```

Branch: `security/batch-d-hardening`. Commit after each task with the message given in the task (human-style, no AI attribution).

---

### Task 1: Migration 104 — `rate_limits` table

**Files:**
- `lib/data/postgres/migrations/104_rate_limits.sql` (new)

**Steps:**

- [ ] Confirm the next free migration number: `ls lib/data/postgres/migrations/ | tail -3`. Migrations currently end at `102_day_checkins.sql`; the quick-wins plan reserves **103** for indexes. If 103 does not exist yet, still use **104** here (numbering gaps are fine; the migration runner applies files in order) — but if some other migration already took 104, renumber this file to the next free number and update every reference in this plan.
- [ ] Create `lib/data/postgres/migrations/104_rate_limits.sql`:

```sql
-- Shared rate-limit counters. One row per limiter key; the window rolls
-- forward atomically in the upsert (see lib/rate-limit.ts). Survives deploys
-- and is shared across replicas, unlike the in-memory L1 map.
CREATE TABLE IF NOT EXISTS rate_limits (
  key          text PRIMARY KEY,
  count        integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL DEFAULT now()
);
```

- [ ] Apply locally: `node scripts/local-db/migrate.js` (or re-run `pnpm db:local`), then verify: `psql -c '\d rate_limits'` shows the three columns with `key` as PK.
- [ ] Commit: `Add rate_limits table for shared rate limiting`

> **Infra note:** no Railway action needed — `ensureSchema` auto-applies migrations on cold start after deploy.

---

### Task 2: Postgres-backed rate limiter (L1 map + authoritative shared store)

**Files:**
- `lib/rate-limit.ts` (rewrite)
- `lib/__tests__/rate-limit.test.ts` (new)

The call signature `rateLimit(key: string, limit: number, windowMs: number): boolean` **must not change** — it is used synchronously at ~15 call sites including `auth.ts:23` (grep: `rateLimit\(`). Design: the sync decision comes from the L1 map exactly as today; every allowed call also queues a coalesced background upsert into `rate_limits`, and the returned DB count/window overwrite the L1 entry, so a count accumulated on another replica (or before a deploy restart) denies from the *next* call onward. Accepted trade-off (document in the file header): a freshly-restarted replica lets at most a handful of requests through before the first DB round-trip lands.

**Steps:**

- [ ] Write `lib/__tests__/rate-limit.test.ts` first (tests fail until Step 2). Mock the pg client module and simulate the SQL upsert semantics in JS so expectations are computable:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-JS simulation of the 104_rate_limits upsert: increment within the
// window, reset when window_start has expired.
const db = vi.hoisted(() => ({
  rows: new Map<string, { count: number; windowStartMs: number }>(),
  failing: false,
}))

vi.mock('@/lib/data/postgres/client', () => ({
  ensureSchema: vi.fn(async () => {}),
  getPool: () => ({
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      if (db.failing) throw new Error('connection refused')
      if (sql.startsWith('DELETE')) return { rows: [] }
      const [key, inc, windowSec] = params as [string, number, number]
      const now = Date.now()
      const row = db.rows.get(key)
      if (!row || row.windowStartMs <= now - windowSec * 1000) {
        db.rows.set(key, { count: inc, windowStartMs: now })
      } else {
        row.count += inc
      }
      const r = db.rows.get(key)!
      return { rows: [{ count: String(r.count), window_start_ms: String(r.windowStartMs) }] }
    }),
  }),
}))

import { rateLimit, _awaitRateLimitFlushes, _resetRateLimitL1 } from '../rate-limit'

beforeEach(() => {
  _resetRateLimitL1()
  db.rows.clear()
  db.failing = false
})

describe('rateLimit', () => {
  it('allows exactly `limit` calls in a window, then denies', async () => {
    expect(rateLimit('k:a', 3, 60_000)).toBe(true)   // count 1
    expect(rateLimit('k:a', 3, 60_000)).toBe(true)   // count 2
    expect(rateLimit('k:a', 3, 60_000)).toBe(true)   // count 3
    expect(rateLimit('k:a', 3, 60_000)).toBe(false)  // count would be 4 > 3
    await _awaitRateLimitFlushes()
    expect(db.rows.get('k:a')!.count).toBe(3)        // denied call is not flushed
  })

  it('resets after the window expires', () => {
    vi.useFakeTimers()
    expect(rateLimit('k:b', 1, 60_000)).toBe(true)
    expect(rateLimit('k:b', 1, 60_000)).toBe(false)
    vi.advanceTimersByTime(60_001)
    expect(rateLimit('k:b', 1, 60_000)).toBe(true)
    vi.useRealTimers()
  })

  it('treats the DB count as authoritative: a fresh L1 with the DB at the limit denies from the second call', async () => {
    // Simulate a prior replica/deploy having consumed the whole window.
    db.rows.set('k:c', { count: 5, windowStartMs: Date.now() })
    expect(rateLimit('k:c', 5, 60_000)).toBe(true)   // L1 is empty — fast path allows (accepted 1-request lag)
    await _awaitRateLimitFlushes()                   // flush returns count 6 → L1 count := 6
    expect(rateLimit('k:c', 5, 60_000)).toBe(false)
  })

  it('falls back to memory-only enforcement when the DB is down', async () => {
    db.failing = true
    expect(rateLimit('k:d', 2, 60_000)).toBe(true)
    expect(rateLimit('k:d', 2, 60_000)).toBe(true)
    expect(rateLimit('k:d', 2, 60_000)).toBe(false)  // in-memory limit still enforced
    await _awaitRateLimitFlushes()                   // must not throw / unhandled-reject
  })

  it('coalesces concurrent increments into the shared store', async () => {
    for (let i = 0; i < 4; i++) rateLimit('k:e', 10, 60_000)
    await _awaitRateLimitFlushes()
    expect(db.rows.get('k:e')!.count).toBe(4)
  })
})
```

- [ ] Run `pnpm test lib/__tests__/rate-limit.test.ts` — all fail (exports missing).
- [ ] Rewrite `lib/rate-limit.ts`:

```ts
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
```

- [ ] `pnpm test lib/__tests__/rate-limit.test.ts` — all 5 pass. `pnpm lint` clean.
- [ ] Verify no call site needs changing: `grep -rn "rateLimit(" app/ auth.ts lib/ --include='*.ts' | grep -v test | grep -v docs` — every site is `if (!rateLimit(...))` or equivalent sync usage; the signature is unchanged.
- [ ] **Manual verification** (`pnpm dev`, local DB): the register limiter is 5/15min per IP. Run 6 times:
  `for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"","password":""}'; done`
  Expect five `400` then one `429`. Then `psql -c "SELECT key, count FROM rate_limits;"` shows `register:<ip>` with `count = 5`. **Restart `pnpm dev`** and immediately send 2 more requests: the first may pass the cold L1 (accepted lag), the second must be `429` — proving the counter survived the restart.
- [ ] Commit: `Back the rate limiter with a shared Postgres store`

---

### Task 3: Bound builder-chat's program schema (fixes its 500 on malformed program)

**Files:**
- `lib/validation/generated-program.ts` (new)
- `lib/__tests__/generated-program-schema.test.ts` (new)
- `app/api/builder-chat/route.ts` (edit)

Today `RequestSchema` has `program: z.any()` (`route.ts:17`) and line 123 dereferences `program.sessions.length` inside the prompt template — a malformed/absent `program` throws outside any guard → 500. The schema below mirrors the `GeneratedProgram` interface in `lib/types/builder.ts` exactly (fields: `name, sessions[{name, icon, exercises[{name, exerciseRole, mainMuscles, secondaryMuscles, progressionStyleName?, progressionStyleId?}]}], phaseStructureName, phaseSetId, reasoning, phases[{name, durationCycles, phaseType, primaryStyleName?}]`). Non-session top-level fields get `.default(...)` so an older draft payload missing them still parses (the route echoes them; the wizard client at `components/workout-builder/builder-review.tsx:257-267` sends the full generate-program output).

**Steps:**

- [ ] Write `lib/__tests__/generated-program-schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { GeneratedProgramSchema } from '../validation/generated-program'
import type { GeneratedProgram } from '../types/builder'

const valid: GeneratedProgram = {
  name: 'Upper/Lower',
  sessions: [{
    name: 'Upper A',
    icon: 'dumbbell',
    exercises: [{
      name: 'Bench Press',
      exerciseRole: 'primary',
      mainMuscles: ['Chest'],
      secondaryMuscles: ['Triceps'],
      progressionStyleName: 'Strength',
    }],
  }],
  phaseStructureName: 'Strength Progression',
  phaseSetId: 'abc-123',
  reasoning: 'Balanced split.',
  phases: [{ name: 'Accumulation', durationCycles: 4, phaseType: 'accumulation' }],
}

describe('GeneratedProgramSchema', () => {
  it('accepts a full generate-program payload and preserves it', () => {
    const parsed = GeneratedProgramSchema.parse(valid)
    expect(parsed).toEqual(valid)
  })

  it('fills defaults for optional top-level fields (older drafts)', () => {
    const { phases: _p, reasoning: _r, phaseSetId: _i, phaseStructureName: _s, ...minimal } = valid
    const parsed = GeneratedProgramSchema.parse(minimal)
    expect(parsed.phases).toEqual([])
    expect(parsed.reasoning).toBe('')
    expect(parsed.sessions[0].exercises[0].name).toBe('Bench Press')
  })

  it('rejects a program with no sessions, garbage, and oversized payloads', () => {
    expect(GeneratedProgramSchema.safeParse({ garbage: true }).success).toBe(false)
    expect(GeneratedProgramSchema.safeParse(null).success).toBe(false)
    expect(GeneratedProgramSchema.safeParse({ ...valid, sessions: [] }).success).toBe(false)
    const bloated = { ...valid, sessions: Array(8).fill(valid.sessions[0]) } // > 7 sessions
    expect(GeneratedProgramSchema.safeParse(bloated).success).toBe(false)
    expect(GeneratedProgramSchema.safeParse({
      ...valid,
      sessions: [{ ...valid.sessions[0], exercises: [{ ...valid.sessions[0].exercises[0], exerciseRole: 'superset' }] }],
    }).success).toBe(false)
  })
})
```

- [ ] Create `lib/validation/generated-program.ts`:

```ts
import { z } from 'zod'

// Bounded request-side mirror of the GeneratedProgram interface
// (lib/types/builder.ts). Used by builder-chat to replace `program: z.any()`
// — caps sizes so a hostile payload can't balloon the Gemini prompt, and
// turns the previous 500 (program.sessions.length on garbage) into a 400.
export const GeneratedExerciseSchema = z.object({
  name: z.string().min(1).max(120),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  mainMuscles: z.array(z.string().max(60)).max(10),
  secondaryMuscles: z.array(z.string().max(60)).max(10),
  progressionStyleName: z.string().max(100).optional(),
  progressionStyleId: z.string().max(100).optional(),
})

export const GeneratedSessionSchema = z.object({
  name: z.string().min(1).max(100),
  icon: z.string().max(60),
  exercises: z.array(GeneratedExerciseSchema).min(1).max(20),
})

export const GeneratedPhaseSchema = z.object({
  name: z.string().min(1).max(100),
  durationCycles: z.number().int().min(1).max(52),
  phaseType: z.string().max(60),
  primaryStyleName: z.string().max(100).optional(),
})

export const GeneratedProgramSchema = z.object({
  name: z.string().min(1).max(100),
  sessions: z.array(GeneratedSessionSchema).min(1).max(7),
  phaseStructureName: z.string().max(100).default(''),
  phaseSetId: z.string().max(100).default(''),
  reasoning: z.string().max(5000).default(''),
  phases: z.array(GeneratedPhaseSchema).max(12).default([]),
})
```

- [ ] `pnpm test lib/__tests__/generated-program-schema.test.ts` — green.
- [ ] Edit `app/api/builder-chat/route.ts`: add `import { GeneratedProgramSchema } from '@/lib/validation/generated-program'` and change line 17 from `program: z.any(),` to `program: GeneratedProgramSchema,`. Nothing else changes — `parsed.data.program` is now typed and `program.sessions.length` at line 123 is safe. Run `npx tsc --noEmit` (the inferred type must satisfy the route's `GeneratedProgram` usages; the `.default()` fields make it structurally compatible).
- [ ] **Manual verification** (`pnpm dev`, authed cookie jar):
  - `curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies -X POST http://localhost:3000/api/builder-chat -H 'Content-Type: application/json' -d '{"message":"hi","program":{"garbage":true},"chatHistory":[],"equipment":["barbell"]}'` → **400** (was 500).
  - Full wizard flow: open `http://localhost:3000` → workout builder → generate a program → use the review-step chat ("swap bench press for dips") → the chat still round-trips and the program updates (requires `GOOGLE_GENERATIVE_AI_API_KEY`; if unset locally, the 400-vs-500 check above is the load-bearing verification since validation runs before the AI call).
- [ ] Commit: `Validate builder-chat program payload instead of z.any()`

---

### Task 4: D2 — PKCE-style binding for the mobile auth deep link

**Files:**
- `lib/pkce.ts` (new)
- `lib/__tests__/pkce.test.ts` (new)
- `lib/mobile-auth-tokens.ts` (edit)
- `lib/__tests__/mobile-auth-tokens.test.ts` (new)
- `components/google-sign-in.tsx` (edit)
- `app/mobile-signin/page.tsx` (edit)
- `app/auth-mobile-bridge/page.tsx` (edit)
- `components/mobile-auth-handler.tsx` (edit)
- `app/api/auth/exchange-mobile-token/route.ts` (edit)

**Threat:** `redirect-client.tsx:10` sends the one-time token over `trainingai://auth-complete?token=…`; any app registering that scheme can capture it and redeem a full 30-day session at `exchange-mobile-token`. **Fix:** the WebView generates a random verifier before opening the Chrome Custom Tab and keeps it in its own `localStorage` (origin = the production site, per `capacitor.config.ts` `server.url` — unreachable to an interceptor app). Only the SHA-256 challenge travels: `Browser.open(/mobile-signin?challenge=…)` → `signIn("google", { callbackUrl: "/auth-mobile-bridge?challenge=…" })` → the bridge stores the challenge alongside the one-time token → exchange requires `sha256(verifier) === challenge`. The intercepted token alone is now worthless. **No APK rebuild needed** — every changed file is web-side and the WebView loads the deployed site.

**Steps:**

- [ ] Write `lib/__tests__/pkce.test.ts` using the RFC 7636 Appendix B test vector:

```ts
import { describe, it, expect } from 'vitest'
import { computePkceChallenge, verifyPkce, PKCE_CHALLENGE_RE, PKCE_VERIFIER_RE } from '../pkce'

// RFC 7636 Appendix B vector
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

describe('pkce', () => {
  it('computes the RFC 7636 S256 challenge', () => {
    expect(computePkceChallenge(VERIFIER)).toBe(CHALLENGE)
  })
  it('verifies a matching pair and rejects mismatches', () => {
    expect(verifyPkce(VERIFIER, CHALLENGE)).toBe(true)
    expect(verifyPkce(VERIFIER, CHALLENGE.slice(0, -1) + 'A')).toBe(false)
    expect(verifyPkce(VERIFIER + 'x', CHALLENGE)).toBe(false)
  })
  it('rejects malformed inputs before hashing', () => {
    expect(verifyPkce('short', CHALLENGE)).toBe(false)
    expect(verifyPkce(VERIFIER, 'not-base64url!!')).toBe(false)
    expect(verifyPkce('', '')).toBe(false)
  })
  it('format regexes match 43-char base64url', () => {
    expect(PKCE_VERIFIER_RE.test(VERIFIER)).toBe(true)
    expect(PKCE_CHALLENGE_RE.test(CHALLENGE)).toBe(true)
    expect(PKCE_CHALLENGE_RE.test(CHALLENGE + 'a')).toBe(false)
  })
})
```

- [ ] Create `lib/pkce.ts`:

```ts
import { createHash, timingSafeEqual } from 'crypto'

// RFC 7636 S256: challenge = BASE64URL(SHA256(ASCII(verifier))).
// 32 random bytes → 43 base64url chars; RFC allows verifiers of 43–128 chars.
export const PKCE_VERIFIER_RE = /^[A-Za-z0-9_-]{43,128}$/
export const PKCE_CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/

export function computePkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url')
}

export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_RE.test(verifier) || !PKCE_CHALLENGE_RE.test(challenge)) return false
  const a = Buffer.from(computePkceChallenge(verifier))
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] `pnpm test lib/__tests__/pkce.test.ts` — green.
- [ ] Write `lib/__tests__/mobile-auth-tokens.test.ts` (tests the challenge binding + one-time semantics + expiry):

```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createMobileAuthToken, consumeMobileAuthToken } from '../mobile-auth-tokens'

afterEach(() => vi.useRealTimers())

describe('mobile auth tokens', () => {
  it('round-trips cookie value and challenge, one time only', () => {
    const token = createMobileAuthToken('cookie-value', 'challenge-abc')
    expect(consumeMobileAuthToken(token)).toEqual({ sessionCookieValue: 'cookie-value', challenge: 'challenge-abc' })
    expect(consumeMobileAuthToken(token)).toBeNull() // consumed
  })
  it('returns null for unknown tokens', () => {
    expect(consumeMobileAuthToken('nope')).toBeNull()
  })
  it('expires after 5 minutes', () => {
    vi.useFakeTimers()
    const token = createMobileAuthToken('cookie-value', 'challenge-abc')
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)
    expect(consumeMobileAuthToken(token)).toBeNull()
  })
})
```

- [ ] Edit `lib/mobile-auth-tokens.ts` — bind the challenge to the token:

```ts
interface TokenEntry {
  sessionCookieValue: string;
  challenge: string;
  expiresAt: number;
}
```

  `createMobileAuthToken(sessionCookieValue: string, challenge: string): string` stores `{ sessionCookieValue, challenge, expiresAt: Date.now() + 5 * 60 * 1000 }`. `consumeMobileAuthToken(token: string): { sessionCookieValue: string; challenge: string } | null` returns both fields (same delete-then-check-expiry logic as today). Update the file's header comment to mention the PKCE binding.
- [ ] `pnpm test lib/__tests__/mobile-auth-tokens.test.ts` — green. `npx tsc --noEmit` now flags the two call sites — fix them in the next steps.
- [ ] Edit `components/google-sign-in.tsx` — generate the verifier in the WebView before opening the Custom Tab:

```tsx
"use client";
import { Button } from "@/components/ui/button";
import { signIn } from "next-auth/react";

const RAILWAY_URL = "https://trainingai-production.up.railway.app";
export const MOBILE_AUTH_VERIFIER_KEY = "ta-mobile-auth-verifier";

function base64url(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function GoogleSignIn() {
  async function handleSignIn() {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      const { Browser } = await import("@capacitor/browser");
      // PKCE-style binding: the verifier never leaves this WebView's
      // localStorage; only its SHA-256 challenge rides the OAuth flow, so an
      // app intercepting the trainingai:// deep link can't redeem the token.
      const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
      const digest = new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      );
      const challenge = base64url(digest);
      localStorage.setItem(MOBILE_AUTH_VERIFIER_KEY, verifier);
      await Browser.open({ url: `${RAILWAY_URL}/mobile-signin?challenge=${challenge}` });
    } else {
      signIn("google", { callbackUrl: "/" });
    }
  }
  // ... existing JSX unchanged
}
```

  (Keep the existing button JSX exactly as-is; only `handleSignIn` and the new exports change.)
- [ ] Edit `app/mobile-signin/page.tsx` — thread the challenge through next-auth's `callbackUrl` (read via `window.location.search` inside the existing `useEffect` to avoid a `useSearchParams` Suspense boundary):

```tsx
useEffect(() => {
  const challenge = new URLSearchParams(window.location.search).get("challenge") ?? "";
  signIn("google", {
    callbackUrl: `/auth-mobile-bridge?challenge=${encodeURIComponent(challenge)}`,
  });
}, []);
```

- [ ] Edit `app/auth-mobile-bridge/page.tsx` — require a well-formed challenge (fail closed) and bind it to the token:

```tsx
import { PKCE_CHALLENGE_RE } from "@/lib/pkce";

export default async function AuthMobileBridgePage({
  searchParams,
}: {
  searchParams: Promise<{ challenge?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  const { challenge } = await searchParams;
  if (!challenge || !PKCE_CHALLENGE_RE.test(challenge)) redirect("/sign-in");

  const cookieStore = await cookies();
  const sessionCookie =
    cookieStore.get("__Secure-authjs.session-token") ??
    cookieStore.get("authjs.session-token");
  if (!sessionCookie?.value) redirect("/sign-in");

  const token = createMobileAuthToken(sessionCookie.value, challenge);
  return <MobileBridgeRedirect token={token} />;
}
```

- [ ] Edit `components/mobile-auth-handler.tsx` `handleAuthUrl` — send the verifier and clear it on success:

```ts
async function handleAuthUrl(url: string) {
  if (!url.startsWith("trainingai://auth-complete")) return;
  const token = new URL(url).searchParams.get("token");
  if (!token) return;
  const verifier = localStorage.getItem("ta-mobile-auth-verifier");
  try {
    const res = await fetch("/api/auth/exchange-mobile-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, verifier }),
    });
    if (res.ok) localStorage.removeItem("ta-mobile-auth-verifier");
    await Browser.close().catch(() => {});
    window.location.href = "/";
  } catch {
    // Non-fatal — user can retry sign-in
  }
}
```

  (Use the string literal for the key here rather than importing from `google-sign-in.tsx`, or move `MOBILE_AUTH_VERIFIER_KEY` into `lib/pkce-client.ts` shared by both — pick the import if it doesn't create a client/server boundary issue; both components are `"use client"`, so importing the constant from `google-sign-in.tsx` is fine.)
- [ ] Edit `app/api/auth/exchange-mobile-token/route.ts` — require the verifier:

```ts
import { verifyPkce } from "@/lib/pkce";

// ... after the rate-limit block:
const body = await req.json().catch(() => null);
const token = body?.token as string | undefined;
const verifier = body?.verifier as string | undefined;
if (!token || !verifier) return NextResponse.json({ error: "Missing token or verifier" }, { status: 400 });

const entry = consumeMobileAuthToken(token);
if (!entry || !verifyPkce(verifier, entry.challenge)) {
  return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
}
const sessionCookieValue = entry.sessionCookieValue;
// ... rest unchanged
```

  Note: the token is consumed even when the verifier fails — deliberate; a captured token burns on first (attacker) attempt rather than staying redeemable.
- [ ] `pnpm test && pnpm lint && npx tsc --noEmit` — green.
- [ ] **Manual verification** (`pnpm dev`; the native pieces can't run in the sandbox, so exercise the HTTP surface):
  - `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/exchange-mobile-token -H 'Content-Type: application/json' -d '{"token":"x"}'` → **400** (missing verifier).
  - `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/api/auth/exchange-mobile-token -H 'Content-Type: application/json' -d '{"token":"x","verifier":"dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"}'` → **401** (unknown token).
  - Logged-in browser: visit `http://localhost:3000/auth-mobile-bridge` (no challenge) → redirected to `/sign-in`; visit `/auth-mobile-bridge?challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` → "Returning to app…" renders (deep link fires into the void on desktop — expected).
- [ ] **On-device verification (post-deploy, no APK rebuild):** since the APK's WebView loads the deployed site, after this merges to `main` sign out on the phone and sign back in via Google — the full verifier round-trip must complete and land you authenticated. This is the authoritative check; flag it in the PR description.
- [ ] Commit: `Bind mobile auth deep-link token to a PKCE verifier`

---

### Task 5: D4 — Oura OAuth `state` parameter (CSRF on callback)

**Files:**
- `lib/oura/oauth-state.ts` (new)
- `lib/__tests__/oura-oauth-state.test.ts` (new)
- `lib/oura/client.ts` (edit `buildAuthUrl`)
- `app/api/oura/connect/route.ts` (edit)
- `app/api/oura/callback/route.ts` (edit)

No jose helpers exist in the repo yet (jose v6 is a direct dependency; next-auth uses it internally) — this creates the first one, signed with the existing `AUTH_SECRET` env (see `auth.config.ts:7`). `sameSite: "lax"` is correct: the callback is a top-level GET navigation from `cloud.ouraring.com`, so the cookie is sent.

**Steps:**

- [ ] Write `lib/__tests__/oura-oauth-state.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest'
import { SignJWT } from 'jose'
import { generateOuraState, signOuraState, verifyOuraState } from '../oura/oauth-state'

beforeAll(() => { process.env.AUTH_SECRET = 'test-secret-at-least-32-chars-long!!' })

describe('oura oauth state', () => {
  it('round-trips: signed cookie verifies against the same state', async () => {
    const state = generateOuraState()
    expect(state).toMatch(/^[A-Za-z0-9_-]{22,}$/) // 16 bytes base64url
    const cookie = await signOuraState(state)
    expect(await verifyOuraState(cookie, state)).toBe(true)
  })
  it('rejects a different state value', async () => {
    const cookie = await signOuraState(generateOuraState())
    expect(await verifyOuraState(cookie, generateOuraState())).toBe(false)
  })
  it('rejects a tampered or garbage cookie', async () => {
    const state = generateOuraState()
    const cookie = await signOuraState(state)
    expect(await verifyOuraState(cookie.slice(0, -2) + 'xx', state)).toBe(false)
    expect(await verifyOuraState('not-a-jwt', state)).toBe(false)
  })
  it('rejects an expired cookie', async () => {
    const state = generateOuraState()
    const expired = await new SignJWT({ state })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET))
    expect(await verifyOuraState(expired, state)).toBe(false)
  })
  it('rejects a token signed with a different secret', async () => {
    const state = generateOuraState()
    const forged = await new SignJWT({ state })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('attacker-secret-32-chars-long-xxxx'))
    expect(await verifyOuraState(forged, state)).toBe(false)
  })
})
```

- [ ] Create `lib/oura/oauth-state.ts`:

```ts
import { SignJWT, jwtVerify } from 'jose'
import { randomBytes } from 'crypto'

// CSRF protection for the Oura OAuth flow: /api/oura/connect puts a random
// state in the authorize URL AND (HS256-signed, 10-min expiry) in an httpOnly
// cookie; the callback only proceeds if the two match. Signed with the same
// AUTH_SECRET next-auth uses.
export const OURA_STATE_COOKIE = 'oura_oauth_state'

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error('AUTH_SECRET is not set')
  return new TextEncoder().encode(secret)
}

export function generateOuraState(): string {
  return randomBytes(16).toString('base64url')
}

export async function signOuraState(state: string): Promise<string> {
  return new SignJWT({ state })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(secretKey())
}

export async function verifyOuraState(cookieValue: string, callbackState: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(cookieValue, secretKey(), { algorithms: ['HS256'] })
    return typeof payload.state === 'string'
      && payload.state.length >= 16
      && payload.state === callbackState
  } catch {
    return false
  }
}
```

- [ ] `pnpm test lib/__tests__/oura-oauth-state.test.ts` — green.
- [ ] Edit `lib/oura/client.ts` `buildAuthUrl` — add a required `state` param:

```ts
export function buildAuthUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'daily heartrate spo2 workout personal session ring_configuration',
    state,
  })
  return `${OURA_AUTH}?${params}`
}
```

- [ ] Edit `app/api/oura/connect/route.ts` — generate, sign, set cookie:

```ts
import { generateOuraState, signOuraState, OURA_STATE_COOKIE } from "@/lib/oura/oauth-state"
// ... inside GET, after the env checks:
const state = generateOuraState()
const url = buildAuthUrl(clientId, redirectUri, state)
const res = NextResponse.redirect(url)
res.cookies.set(OURA_STATE_COOKIE, await signOuraState(state), {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/api/oura',
  maxAge: 600,
})
return res
```

- [ ] Edit `app/api/oura/callback/route.ts` — verify before touching `code`, and always clear the cookie:

```ts
import { verifyOuraState, OURA_STATE_COOKIE } from "@/lib/oura/oauth-state"
// ... after the session check, before the code/error handling:
const state = searchParams.get("state")
const stateCookie = req.cookies.get(OURA_STATE_COOKIE)?.value
if (!state || !stateCookie || !(await verifyOuraState(stateCookie, state))) {
  const res = NextResponse.redirect(appUrl("/more?oura_error=state_mismatch"))
  res.cookies.delete(OURA_STATE_COOKIE)
  return res
}
```

  and add `res.cookies.delete(OURA_STATE_COOKIE)` to the success and token-exchange-failure redirects (build the `NextResponse.redirect` into a local `res` first in each branch).
- [ ] `npx tsc --noEmit` — the only `buildAuthUrl` caller is `connect/route.ts` (verified by grep), so nothing else breaks.
- [ ] **Manual verification** (`pnpm dev`; add throwaway values `OURA_CLIENT_ID=test-client` and `OURA_REDIRECT_URI=http://localhost:3000/api/oura/callback` to `.env.local` for this test, remove after):
  - `curl -s -D - -o /dev/null -b /tmp/ta-cookies http://localhost:3000/api/oura/connect` → `location:` header contains `&state=<22+ chars>` and a `set-cookie: oura_oauth_state=eyJ…; Path=/api/oura; HttpOnly` header.
  - `curl -s -D - -o /dev/null -b /tmp/ta-cookies "http://localhost:3000/api/oura/callback?code=x&state=WRONG"` → redirect to `/more?oura_error=state_mismatch`.
  - Missing cookie: same URL without replaying the state cookie → `state_mismatch`.
- [ ] **Infra note:** production re-connect flow should be smoke-tested once after deploy (More → connect Oura) since the real Oura redirect must round-trip the state. No env changes.
- [ ] Commit: `Add signed state parameter to Oura OAuth flow`

---

### Task 6: D4 — nutrition/scan guarded body parse + mimeType allowlist

**Files:**
- `lib/http/request-guards.ts` (new)
- `lib/__tests__/request-guards.test.ts` (new)
- `app/api/nutrition/scan/route.ts` (edit)

Today `scan/route.ts:41` runs `await req.json()` **before** any size check — a 100 MB body is fully buffered and parsed before the base64 check at line 44 rejects it — and `body.mimeType` is cast to the union type without validation (line 77).

**Steps:**

- [ ] Write `lib/__tests__/request-guards.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readJsonLimited, isAllowedImageMime } from '../http/request-guards'

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/test', { method: 'POST', body, headers })
}

describe('readJsonLimited', () => {
  it('parses a small valid JSON body', async () => {
    const result = await readJsonLimited(post('{"a":1}'), 1024)
    expect(result).toEqual({ ok: true, body: { a: 1 } })
  })
  it('rejects via Content-Length before reading the stream', async () => {
    const fake = { headers: new Headers({ 'content-length': '99999999' }), body: null } as unknown as Request
    expect(await readJsonLimited(fake, 1024)).toEqual({ ok: false, reason: 'too_large' })
  })
  it('rejects a streamed body that exceeds the limit', async () => {
    // 100-byte JSON against a 50-byte cap
    const big = `{"pad":"${'x'.repeat(90)}"}`
    expect(await readJsonLimited(post(big), 50)).toEqual({ ok: false, reason: 'too_large' })
  })
  it('rejects invalid JSON within the limit', async () => {
    expect(await readJsonLimited(post('not json'), 1024)).toEqual({ ok: false, reason: 'invalid_json' })
  })
})

describe('isAllowedImageMime', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('allows %s', (m) => {
    expect(isAllowedImageMime(m)).toBe(true)
  })
  it.each(['image/gif', 'image/svg+xml', 'text/html', '', undefined, 42, 'IMAGE/JPEG; charset=x'])(
    'rejects %s', (m) => { expect(isAllowedImageMime(m)).toBe(false) },
  )
})
```

- [ ] Create `lib/http/request-guards.ts`:

```ts
export type LimitedJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; reason: 'too_large' | 'invalid_json' | 'no_body' }

// Size-guarded JSON body read: checks Content-Length first, then streams with
// a hard byte cap so an oversized body is cancelled instead of buffered —
// unlike req.json(), which buffers everything before any check can run.
export async function readJsonLimited(req: Request, maxBytes: number): Promise<LimitedJsonResult> {
  const contentLength = req.headers.get('content-length')
  if (contentLength && Number(contentLength) > maxBytes) return { ok: false, reason: 'too_large' }

  const reader = req.body?.getReader()
  if (!reader) return { ok: false, reason: 'no_body' }

  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      return { ok: false, reason: 'too_large' }
    }
    chunks.push(value)
  }
  try {
    return { ok: true, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  } catch {
    return { ok: false, reason: 'invalid_json' }
  }
}

export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number]

export function isAllowedImageMime(v: unknown): v is AllowedImageMime {
  return typeof v === 'string' && (ALLOWED_IMAGE_MIME as readonly string[]).includes(v)
}
```

- [ ] `pnpm test lib/__tests__/request-guards.test.ts` — green.
- [ ] Edit `app/api/nutrition/scan/route.ts` — replace lines 41-46 (`const body = await req.json()` through the base64 check) with:

```ts
// 5 MB of raw image bytes ≈ 6.8 MB base64 chars; 8 MB covers JSON overhead.
const MAX_BODY_BYTES = 8 * 1024 * 1024
const read = await readJsonLimited(req, MAX_BODY_BYTES)
if (!read.ok) {
  return read.reason === 'too_large'
    ? NextResponse.json({ error: 'Request too large' }, { status: 413 })
    : NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
}
const body = read.body as Record<string, unknown>

const MAX_BASE64_BYTES = 5 * 1024 * 1024
if (typeof body.image === 'string' && Buffer.byteLength(body.image, 'base64') > MAX_BASE64_BYTES) {
  return NextResponse.json({ error: 'Image too large' }, { status: 413 })
}
```

  and in the image branch (currently line 63) validate the mime **before** use:

```ts
if (body.image && body.mimeType) {
  if (!isAllowedImageMime(body.mimeType)) {
    return NextResponse.json({ error: 'Unsupported image type' }, { status: 415 })
  }
  const imageBuffer = Buffer.from(body.image as string, 'base64')
  // ... mediaType: body.mimeType  (now the narrowed AllowedImageMime — drop the `as` cast)
```

  Import `readJsonLimited, isAllowedImageMime` from `@/lib/http/request-guards`. Keep everything else (region hint, prompts, `sanitiseNutrition`) unchanged.
- [ ] `npx tsc --noEmit` + `pnpm lint` — green (note `body.region` and `body.text` accesses still typecheck against `Record<string, unknown>`; add narrow `typeof` checks where the compiler complains, e.g. `const region = typeof body.region === 'string' ? body.region : 'AU'`).
- [ ] **Manual verification** (`pnpm dev`, authed):
  - `python3 -c "print('{\"text\":\"' + 'a'*9000000 + '\"}')" > /tmp/big.json && curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies -X POST http://localhost:3000/api/nutrition/scan -H 'Content-Type: application/json' --data-binary @/tmp/big.json` → **413**.
  - `curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies -X POST http://localhost:3000/api/nutrition/scan -H 'Content-Type: application/json' -d '{"image":"aGVsbG8=","mimeType":"image/gif"}'` → **415**.
  - `curl -s -b /tmp/ta-cookies -X POST http://localhost:3000/api/nutrition/scan -H 'Content-Type: application/json' -d '{"text":"one banana"}'` → 200 with nutrition JSON (needs `GOOGLE_GENERATIVE_AI_API_KEY`; a 502 "AI service unavailable" is acceptable proof the guards passed if the key is absent).
- [ ] Commit: `Guard nutrition scan body size and image mime before parsing`

---

### Task 7: D4 — numeric clamps: ai-chat weight regex + body-metadata POST

**Files:**
- `lib/validation/body-metrics.ts` (new)
- `lib/__tests__/body-metrics-validation.test.ts` (new)
- `app/api/body-metadata/route.ts` (edit POST)
- `app/api/ai-chat/route.ts` (edit ~line 219)

The clamp range for weight **copies the profile route** (`app/api/user/profile/route.ts:11`): `weightGoalKg: z.number().min(20).max(500)` → weight is 20–500 kg. (Profile's other clamp, `heightCm` 50–300, is not a body-metadata field.) The remaining bounds are new but deliberately generous sanity caps, documented inline.

**Steps:**

- [ ] Write `lib/__tests__/body-metrics-validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { BodyMetadataPostSchema, validWeightKgOrNull, WEIGHT_KG_MIN, WEIGHT_KG_MAX } from '../validation/body-metrics'

describe('validWeightKgOrNull', () => {
  it('passes in-range weights through', () => {
    expect(validWeightKgOrNull(82.5)).toBe(82.5)
    expect(validWeightKgOrNull(WEIGHT_KG_MIN)).toBe(20)
    expect(validWeightKgOrNull(WEIGHT_KG_MAX)).toBe(500)
  })
  it('nulls out-of-range and non-finite values', () => {
    expect(validWeightKgOrNull(19.9)).toBeNull()
    expect(validWeightKgOrNull(500.1)).toBeNull()
    expect(validWeightKgOrNull(9999)).toBeNull()
    expect(validWeightKgOrNull(NaN)).toBeNull()
    expect(validWeightKgOrNull(Infinity)).toBeNull()
  })
})

describe('BodyMetadataPostSchema', () => {
  it('accepts a normal manual log', () => {
    const r = BodyMetadataPostSchema.safeParse({ localDate: '2026-07-01', weightKg: 82.5, bodyFat: 18, steps: 9200 })
    expect(r.success).toBe(true)
  })
  it('accepts nulls and omissions (partial upserts)', () => {
    expect(BodyMetadataPostSchema.safeParse({}).success).toBe(true)
    expect(BodyMetadataPostSchema.safeParse({ weightKg: null }).success).toBe(true)
  })
  it('accepts slash dates (legacy client format)', () => {
    expect(BodyMetadataPostSchema.safeParse({ localDate: '2026/07/01' }).success).toBe(true)
  })
  it('rejects out-of-range numbers', () => {
    expect(BodyMetadataPostSchema.safeParse({ weightKg: 5000 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ weightKg: 10 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ bodyFat: 95 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ steps: -1 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ steps: 1.5 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ calories: 100000 }).success).toBe(false)
    expect(BodyMetadataPostSchema.safeParse({ localDate: 'yesterday' }).success).toBe(false)
  })
})
```

- [ ] Create `lib/validation/body-metrics.ts`:

```ts
import { z } from 'zod'

// Weight range copied from the profile route's weightGoalKg clamp
// (app/api/user/profile/route.ts). Other bounds are generous sanity caps —
// they exist to stop a stray regex match or malformed client write from
// poisoning trends, not to police plausible data.
export const WEIGHT_KG_MIN = 20
export const WEIGHT_KG_MAX = 500

export function validWeightKgOrNull(n: number): number | null {
  return Number.isFinite(n) && n >= WEIGHT_KG_MIN && n <= WEIGHT_KG_MAX ? n : null
}

export const BodyMetadataPostSchema = z.object({
  localDate:  z.string().regex(/^\d{4}[-/]\d{2}[-/]\d{2}$/).optional(),
  weightKg:   z.number().min(WEIGHT_KG_MIN).max(WEIGHT_KG_MAX).nullish(),
  bodyFat:    z.number().min(1).max(80).nullish(),
  calories:   z.number().min(0).max(20000).nullish(),
  protein:    z.number().min(0).max(2000).nullish(),
  carb:       z.number().min(0).max(2000).nullish(),
  fat:        z.number().min(0).max(2000).nullish(),
  steps:      z.number().int().min(0).max(200000).nullish(),
  distanceKm: z.number().min(0).max(1000).nullish(),
})
```

- [ ] `pnpm test lib/__tests__/body-metrics-validation.test.ts` — green.
- [ ] Edit `app/api/body-metadata/route.ts` POST — replace the hand-typed `body` interface + bare `req.json()` (lines 146-158) with:

```ts
import { BodyMetadataPostSchema } from "@/lib/validation/body-metrics";
// ...
let raw: unknown;
try { raw = await req.json(); }
catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

const parsed = BodyMetadataPostSchema.safeParse(raw);
if (!parsed.success) {
  return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
}
const body = parsed.data;
```

  The rest of the handler (`localDate` slash-replace, upsert mapping) stays byte-identical.
- [ ] Edit `app/api/ai-chat/route.ts` (~line 218-219) — clamp the regex-extracted weight before it can be written to the DB:

```ts
import { validWeightKgOrNull } from "@/lib/validation/body-metrics";
// ...
const weightMatch = /(\d+(?:\.\d+)?)\s*kg/i.exec(prompt);
const parsedWeight = weightMatch ? validWeightKgOrNull(parseFloat(weightMatch[1])) : null;
```

  (The existing `if (isBodyWeightLog && parsedWeight !== null)` guard then skips the write for out-of-range values — no other change needed.)
- [ ] `pnpm test && npx tsc --noEmit` — green.
- [ ] **Manual verification** (`pnpm dev`, authed):
  - `curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies -X POST http://localhost:3000/api/body-metadata -H 'Content-Type: application/json' -d '{"weightKg":5000}'` → **400**.
  - `curl -s -b /tmp/ta-cookies -X POST http://localhost:3000/api/body-metadata -H 'Content-Type: application/json' -d '{"weightKg":82.5}'` → `{"success":true,...}`, then `psql -c "SELECT date, weight_kg FROM body_metrics ORDER BY date DESC LIMIT 1;"` shows 82.5.
  - AI chat: send "log my weight as 9999 kg" via the chat UI (or POST to `/api/ai-chat` matching its request shape) → `psql` shows **no** 9999 row; "log my weight as 83 kg" → row written.
- [ ] Commit: `Clamp body metric writes from ai-chat and body-metadata`

---

### Task 8: D4 — enforce CSP (staged, no `unsafe-eval` in production)

**Files:**
- `next.config.ts` (edit)

**Consumer audit (why each directive survives):**
- `'unsafe-eval'` — needed only by **dev tooling** (Turbopack/React Refresh use `eval` for HMR). Production consumers: none found — the bundle uses no `eval`/`new Function` (react-markdown, KaTeX, chart.js, react-syntax-highlighter, motion, leaflet are all eval-free). → **dev-only, dropped from the production header.**
- `script-src 'unsafe-inline'` — Next.js App Router emits inline bootstrap/Flight scripts on every SSR'd page and there is no `middleware.ts` to thread a per-request nonce. **Kept, with a comment**; nonce-based CSP via middleware is a documented follow-up (see Follow-ups).
- `style-src 'unsafe-inline'` — Tailwind v4 itself compiles to a static stylesheet (does NOT need this), but `motion`, Radix primitives and `next-themes` set inline `style` attributes, which `style-src 'unsafe-inline'` governs. **Kept, with a comment.**
- Everything else (img tiles, Google OAuth, Gemini/Oura connect-src, `frame-src 'none'`) carries over unchanged.

**Steps:**

- [ ] Edit `next.config.ts`: replace the `Content-Security-Policy-Report-Only` entry with an enforced header, dev-conditional on eval:

```ts
const isDev = process.env.NODE_ENV === 'development';

const csp = [
  "default-src 'self'",
  // 'unsafe-inline': Next.js App Router emits inline bootstrap/Flight scripts
  // and we have no middleware to attach nonces (follow-up). 'unsafe-eval' is
  // dev-only — Turbopack/React Refresh need eval for HMR; production does not.
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://accounts.google.com`,
  // 'unsafe-inline' styles: motion/Radix/next-themes set inline style
  // attributes (Tailwind itself is a compiled stylesheet and doesn't need it).
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://lh3.googleusercontent.com https://lh4.googleusercontent.com https://lh5.googleusercontent.com https://lh6.googleusercontent.com",
  "font-src 'self'",
  "connect-src 'self' https://generativelanguage.googleapis.com https://accounts.google.com https://oauth2.googleapis.com https://cloud.ouraring.com https://api.ouraring.com wss: ws:",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join('; ');
```

  and in `securityHeaders`, swap `{ key: 'Content-Security-Policy-Report-Only', value: [...] }` for `{ key: 'Content-Security-Policy', value: csp }`. Delete the old report-only block entirely.
- [ ] **Stage 1 verification — production build locally** (dev mode would mask the eval question): `pnpm build && pnpm start` (with `.env.local` DB), then:
  - `curl -sI http://localhost:3000/login | grep -i content-security-policy` → the enforced header, **without** `unsafe-eval`.
  - In a browser against `localhost:3000`, exercise: login (credentials), home/session-select, a workout start, nutrition tab (chart render), health tab (chart + map-free views), AI chat send, workout builder open. The devtools console must show **zero** `Content-Security-Policy` violation errors.
- [ ] **Stage 2 verification — dev mode still works:** `pnpm dev`, load the home page, confirm HMR functions and no CSP errors (the dev header includes `unsafe-eval`).
- [ ] **Post-deploy watch (infra note):** after this reaches production, check the app on the phone (WebView) — barcode scanner, Leaflet map on activity views, and Google sign-in are the highest-risk surfaces. Rollback is a one-line revert of the header key if something breaks.
- [ ] Commit: `Enforce Content-Security-Policy, drop unsafe-eval in production`

---

### Task 9: D4 — `requireAdmin` typed error, 403s everywhere, honest comment

**Files:**
- `lib/admin.ts` (edit)
- `lib/__tests__/admin.test.ts` (new)
- Unwrapped call sites (all return 500 today because nothing catches the throw): `app/api/admin/mirror-dataset-gifs/route.ts:19`, `app/api/admin/seed-exercise-gifs/route.ts:11`, `app/api/admin/list-ai-models/route.ts:8`, `app/api/admin/reference-figure/route.ts:9,18`, `app/api/admin/test-exercise-image/route.ts:24`, `app/api/admin/exercises/route.ts:23,48,79,122`, `app/api/admin/generate-exercise-media/route.ts:25,131`

**Decision (matches current route usage):** the majority pattern (`invites`, `fix-exercise-units`, `pending-count`, `activity-types`, `feedback`, `users`) already wraps `await requireAdmin(...)` in try/catch → 403. So keep the throwing API, make the throw a typed `AdminError`, and bring the 12 bare call sites into the same try/catch pattern. Also fix the **misleading comment**: it claims the JWT `isAdmin` is used "to avoid a DB round-trip", but the parameter is deliberately ignored and the DB is always consulted.

**Steps:**

- [ ] Write `lib/__tests__/admin.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getUserById = vi.fn()
vi.mock('@/lib/data', () => ({ getRepository: async () => ({ getUserById }) }))

import { requireAdmin, AdminError } from '../admin'

beforeEach(() => getUserById.mockReset())

describe('requireAdmin', () => {
  it('resolves for an admin user', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: true })
    await expect(requireAdmin('u1')).resolves.toBeUndefined()
  })
  it('throws AdminError for a non-admin user', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })
    await expect(requireAdmin('u1')).rejects.toBeInstanceOf(AdminError)
  })
  it('throws AdminError for an empty userId without hitting the repo', async () => {
    await expect(requireAdmin('')).rejects.toBeInstanceOf(AdminError)
    expect(getUserById).not.toHaveBeenCalled()
  })
  it('ignores a stale JWT isAdmin=true flag — the DB is authoritative', async () => {
    getUserById.mockResolvedValue({ id: 'u1', isAdmin: false })
    await expect(requireAdmin('u1', true)).rejects.toBeInstanceOf(AdminError)
  })
})
```

- [ ] Rewrite `lib/admin.ts`:

```ts
import { getRepository } from '@/lib/data'

export class AdminError extends Error {
  constructor() {
    super('Forbidden')
    this.name = 'AdminError'
  }
}

// The JWT isAdmin flag is deliberately IGNORED here: it is stamped at login
// and can be stale for up to 30 days (e.g. a revoked admin keeps the old
// token). Admin calls are rare, so the DB round-trip is the point — it is
// the authoritative check. The parameter stays only for call-site
// compatibility. Routes wrap this in try/catch and return a 403.
export async function requireAdmin(userId: string, _isAdmin?: boolean): Promise<void> {
  if (!userId) throw new AdminError()
  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  if (!user?.isAdmin) throw new AdminError()
}

export async function isAdminUser(userId: string, isAdmin?: boolean): Promise<boolean> {
  if (typeof isAdmin === 'boolean') return isAdmin
  const repo = await getRepository()
  const user = await repo.getUserById(userId)
  return user?.isAdmin ?? false
}
```

- [ ] `pnpm test lib/__tests__/admin.test.ts` — green.
- [ ] Re-run the sweep to catch any route added since this plan was written: `grep -rn "await requireAdmin" app/ | grep -v "try"` won't show context — instead check each file from the list above and wrap every **bare** call in the repo's standard pattern:

```ts
try {
  await requireAdmin(session?.user?.id ?? '', session?.user?.isAdmin);
} catch {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
```

  Files/handlers to fix (12 call sites): `mirror-dataset-gifs` POST, `seed-exercise-gifs` POST, `list-ai-models` GET, `reference-figure` GET+POST, `test-exercise-image` (one handler), `exercises` GET+POST+PATCH+DELETE, `generate-exercise-media` POST+GET. Leave the already-wrapped routes untouched.
- [ ] `npx tsc --noEmit && pnpm lint` — green.
- [ ] **Manual verification** (`pnpm dev`; the seeded `test@local.dev` is **not** an admin, which is exactly what we need):
  - `curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies http://localhost:3000/api/admin/list-ai-models` → **403** (was 500).
  - `curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies http://localhost:3000/api/admin/exercises` → **403**.
  - `curl -s -o /dev/null -w "%{http_code}\n" -b /tmp/ta-cookies http://localhost:3000/api/admin/pending-count` → **403** (regression check on an already-wrapped route).
- [ ] Commit: `Return 403 from all admin routes and stop trusting the JWT admin flag`

---

### Task 10: D5 — Oura `fetchDocumentById`: dataType allowlist + encoded id; App Links follow-up

**Files:**
- `lib/oura/client.ts` (edit)
- `lib/__tests__/oura-document-path.test.ts` (new)
- `projectOverview.md` (append follow-up item)

`fetchDocumentById` (`client.ts:249-255`) interpolates both `dataType` and `id` (which comes from an **external webhook payload**) straight into the URL path — a crafted `id` like `../../oauth/token` redirects the authed GET elsewhere on the Oura host. All real call sites (`app/api/oura/webhook/route.ts:92,104,114,142`) pass literal data types, so tightening the type is compile-compatible.

**Steps:**

- [ ] Write `lib/__tests__/oura-document-path.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { ouraDocumentPath } from '../oura/client'

describe('ouraDocumentPath', () => {
  it('builds the path for an allowlisted type', () => {
    expect(ouraDocumentPath('daily_readiness', 'abc-123')).toBe('/v2/usercollection/daily_readiness/abc-123')
  })
  it('URL-encodes the document id', () => {
    expect(ouraDocumentPath('sleep', 'a/../b?x=1&y=2')).toBe('/v2/usercollection/sleep/a%2F..%2Fb%3Fx%3D1%26y%3D2')
  })
  it('throws for non-allowlisted data types', () => {
    expect(() => ouraDocumentPath('daily_readiness/../../oauth', 'x')).toThrow('Unsupported')
    expect(() => ouraDocumentPath('personal_info', 'x')).toThrow('Unsupported')
    expect(() => ouraDocumentPath('', 'x')).toThrow('Unsupported')
  })
})
```

- [ ] Edit `lib/oura/client.ts` — replace `fetchDocumentById` with an allowlisted, encoded version. **Note the TDZ constraint:** `WEBHOOK_DATA_TYPES` is declared at line ~262, *below* `fetchDocumentById` — reference it inside function bodies only (call-time lookup), never in a module-level initializer above its declaration:

```ts
// Path builder for single-document fetches. dataType is allowlisted against
// the webhook subscription types (the only documents we ever fetch by id) and
// the id — which arrives from an external webhook payload — is URL-encoded so
// it cannot traverse into a different API path.
export function ouraDocumentPath(dataType: string, id: string): string {
  if (!(WEBHOOK_DATA_TYPES as readonly string[]).includes(dataType)) {
    throw new Error(`Unsupported Oura document type: ${dataType}`)
  }
  return `/v2/usercollection/${dataType}/${encodeURIComponent(id)}`
}

// Fetch a single document by ID (used after webhook events arrive)
export async function fetchDocumentById<T>(
  token: string,
  dataType: OuraWebhookDataType,
  id: string,
): Promise<T> {
  return ouraGet<T>(token, ouraDocumentPath(dataType, id))
}
```

- [ ] `pnpm test lib/__tests__/oura-document-path.test.ts && npx tsc --noEmit` — green (the webhook route's literal `"daily_readiness"` etc. satisfy `OuraWebhookDataType`).
- [ ] **Follow-up documentation (the D2 alternative requiring native work):** append to `projectOverview.md`'s "What's Left To Do" list:

```md
- [ ] **Android App Links for mobile auth (APK rebuild required):** replace the custom `trainingai://auth-complete` scheme with a verified `https://trainingai-production.up.railway.app/auth-complete` App Link — add an `android:autoVerify="true"` intent filter to `android/app/src/main/AndroidManifest.xml` (the custom-scheme filter is at line ~33), serve `/.well-known/assetlinks.json` (Next.js `public/.well-known/`) containing the release-signing-cert SHA-256 fingerprint, and update `redirect-client.tsx` + `mobile-auth-handler.tsx` to the https URL. This removes the interceptable custom scheme entirely; the PKCE binding (shipped 2026-07) already makes an intercepted token unredeemable, so this is defence-in-depth, not urgent. Needs: signing cert fingerprint, APK rebuild + reinstall.
```

- [ ] Commit: `Allowlist Oura document types and encode webhook document ids`

---

### Task 11: D5 — verify register creates inactive/pending accounts (regression test)

**Files:**
- `lib/__tests__/register-inactive.test.ts` (new)

**Investigation result (already done — write the task accordingly):** the behaviour is **already correct**, so this task is a regression test only, no production code change. Chain: `app/api/auth/register/route.ts:32` calls `repo.createEmailUser(email, hash, name)` **without** an `isActive` argument → `adapter.ts:561-567` defaults `isActive ?? await this.isInvited(email)` → uninvited emails get `is_active = false`; `auth.ts:92-94` then bounces inactive credential logins to `/pending`, and the Google path does the same (`auth.ts:71,89`). The regression risk is someone later passing `isActive: true` from the route — lock it down.

**Steps:**

- [ ] Write `lib/__tests__/register-inactive.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createEmailUser = vi.fn(async () => ({ id: 'u-new', email: 'new@example.com', isActive: false }))
const getUserByEmail = vi.fn(async () => null)

vi.mock('@/lib/data', () => ({ getRepository: async () => ({ createEmailUser, getUserByEmail }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => true }))

import { POST } from '@/app/api/auth/register/route'

beforeEach(() => { createEmailUser.mockClear(); getUserByEmail.mockClear() })

function registerReq(body: object) {
  return new Request('http://localhost/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as never // route types the param as NextRequest; Request is runtime-compatible here
}

describe('register route — accounts must start inactive/pending', () => {
  it('never passes an isActive override to createEmailUser (activation stays with the invite check)', async () => {
    const res = await POST(registerReq({ email: 'new@example.com', password: 'longenough1', name: 'New' }))
    expect(res.status).toBe(200)
    expect(createEmailUser).toHaveBeenCalledTimes(1)
    const args = createEmailUser.mock.calls[0] as unknown[]
    expect(args[0]).toBe('new@example.com')
    expect(args[1]).not.toBe('longenough1')      // hashed, never plaintext
    expect(args.length).toBeLessThanOrEqual(3)    // no 4th isActive argument
    expect(args[3]).toBeUndefined()
  })
  it('rejects duplicate emails without creating a user', async () => {
    getUserByEmail.mockResolvedValueOnce({ id: 'u-existing' } as never)
    const res = await POST(registerReq({ email: 'new@example.com', password: 'longenough1' }))
    expect(res.status).toBe(409)
    expect(createEmailUser).not.toHaveBeenCalled()
  })
})
```

- [ ] `pnpm test lib/__tests__/register-inactive.test.ts` — green with **no production change**. (If it is *not* green — i.e. someone has since made register pass `isActive: true` — that's a real regression: remove the override so activation stays with the adapter's invite check, and re-run.)
- [ ] **Manual verification** (`pnpm dev`, local DB):
  - `curl -s -X POST http://localhost:3000/api/auth/register -H 'Content-Type: application/json' -d '{"email":"pending-check@example.com","password":"longenough1"}'` → `{"ok":true}`.
  - `psql -c "SELECT email, is_active FROM users WHERE email='pending-check@example.com';"` → `is_active = f`.
  - Log in as that user through the login page → lands on `/pending`, not the app.
- [ ] Commit: `Add regression test for inactive-by-default registration`

---

### Task 12: Final verification, docs, PR

**Files:**
- `projectOverview.md`, `docs/planned_upgrades.md`, `package.json`, `lib/changelog.ts`

**Steps:**

- [ ] Full suite: `pnpm test` (all suites incl. the ~9 new files), `pnpm lint`, `npx tsc --noEmit`, `pnpm build` — all green.
- [ ] Full local dev pass (`pnpm dev`): re-run every manual verification block above end-to-end in one session (register 429 + `rate_limits` row, builder-chat 400, exchange-mobile-token 400/401, oura connect state cookie + callback mismatch, scan 413/415, body-metadata 400/success, admin 403s, register inactive). Fix anything broken before proceeding.
- [ ] Bump `package.json` version (minor — new security behaviour) and add a `lib/changelog.ts` entry: "Security hardening: PKCE-bound mobile sign-in, durable rate limits, Oura OAuth CSRF protection, enforced CSP, stricter input validation."
- [ ] Tick the shipped Batch D items in `docs/planned_upgrades.md` (D2, D3 [limiter + builder-chat], D4 [state, scan, clamps, CSP, admin], D5 [fetchDocumentById, register-verified]) — leave D1 + supplement-scope to the quick-wins plan. Mark the App Links follow-up as tracked in `projectOverview.md` (done in Task 10).
- [ ] Push branch `security/batch-d-hardening`, open a PR describing the changes and the two **post-deploy checks**: (1) phone sign-in round-trip (PKCE — no APK rebuild needed), (2) CSP watch on WebView surfaces (scanner, maps, Google sign-in). **Do not merge** — this deploys to production; wait for explicit user confirmation per the standing workflow.

---

## Railway / infra follow-ups (summary)

| Item | Action needed |
|---|---|
| Migration 104 | None — auto-applied by `ensureSchema` on deploy |
| New env vars | None — reuses `AUTH_SECRET`, `OURA_*` |
| PKCE mobile auth | No APK rebuild (WebView loads remote site); post-deploy phone sign-in smoke test |
| CSP | Post-deploy WebView watch (scanner / Leaflet / Google sign-in); rollback = revert header |
| Android App Links (deferred) | Native: manifest intent filter + `assetlinks.json` + signing-cert SHA-256 + **APK rebuild** |
| `next-auth@5-beta` | Watch item — move to GA when released (no code here) |

## Self-review checklist (done during planning)

- **D2** → Task 4 (PKCE binding) + Task 10 follow-up (App Links, native, documented). ✔
- **D3** → Task 1+2 (Postgres limiter, signature preserved, L1 fast-path, authoritative store) + Task 3 (builder-chat schema, fixes the `program.sessions` 500). Prescribe/session-explain limits excluded → quick wins. ✔
- **D4** → Task 5 (Oura state, jose + AUTH_SECRET), Task 6 (scan guarded parse + mime allowlist), Task 7 (clamps copied from profile route's 20–500 weight range), Task 8 (CSP staged, consumers enumerated, prod drops unsafe-eval), Task 9 (AdminError + 403 + honest comment, matches dominant try/catch usage). ✔
- **D5** → Task 10 (allowlist + `encodeURIComponent`), Task 11 (register verified already-inactive → regression test only), supplement-scope excluded → quick wins, next-auth GA noted. ✔
- No placeholders: all SQL, zod schemas, jose sign/verify, PKCE code, clamps, and curl commands are concrete; RFC 7636 vector used for computed test expectations. pnpm throughout; commit messages human-style.
