# "Why this?" (session-explain) Page Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the "Why this?" explanation page open instantly (cache-seeded, no double `getNextSession` recompute), fix its missing safe-area insets, and reorder it narrative-first so the readable AI synthesis leads and the raw jargon signals are grouped/demoted below.

**Architecture:** The Home recommendation card already caches the full `NextSessionRecommendation` (which carries `scoredSessions`, `weightedComponents`, and `signals`) under the client cache key `next-session`. This plan stops the page from recomputing that server-side: it converts `page.tsx` to a thin auth-only server wrapper rendering a client component that seeds synchronously from `readCacheSync('next-session')`, honours the `?sessionId=` param via a TDD'd pure mapper, and revalidates with `cachedFetch`. The AI insight route becomes cache-first keyed off the passed `sessionId` (no `getNextSession` on the cached path), and the narrative card seeds from a client cache key so a repeat visit paints last-known prose with no skeleton. Layout moves the narrative to the top and groups the raw signals under a collapsible via a second pure helper.

**Tech Stack:** Next.js 15 (App Router, RSC + client components), React 19, TypeScript, Tailwind v4, `@ai-sdk/google` (Gemini `gemini-3.1-flash-lite`) via `streamText`, client SQLite/localStorage cache (`lib/sqlite/cache.ts`), vitest (`pnpm test`), `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`.

---

## Verified current state (against main after PR #213, `44d2b72`)

- `app/session-explain/page.tsx:16-22` — server component `await`s `getRepository().getNextSession(userId, tz)` on every open; **ignores the `?sessionId=` query param** entirely (no `searchParams` arg). `primaryReason()` + alternatives + `SessionExplainData` assembly all live here (`:6-57`).
- `app/session-explain/session-explain-content.tsx:74` — header container uses `px-4 pt-4 pb-2` (**no `pt-safe`**); `:86` content container uses `px-4 space-y-3 pb-10` (**no `pb-safe`**).
- `app/session-explain/session-explain-content.tsx:84-143` — render order is `ScoreRing` → `ContributorBars` → 7× jargon `SignalCard` → `AlternativesCard` → `AiInsightCard` **last**. The readable narrative renders last and slowest.
- `app/session-explain/components/ai-insight-card.tsx:11-34` — `useEffect` fetches `/api/session-explain/insight?sessionId=…` on mount and streams; no cache seed, always shows a pulse skeleton first.
- `app/api/session-explain/insight/route.ts:11` — `export async function GET()` takes **no request arg** (the `?sessionId=` the client sends is unused); `:19` calls `getNextSession` a **second time** unconditionally, **then** `:27` checks the per-day cache `getAiHealthInsight(userId, 'session-explain:<id>', today)`, else `:56-62` cold-streams Gemini. So even a cache hit pays a full `getNextSession`.
- `app/session-select/session-select-content.tsx:138-140` seeds recommendation from `sessionStorage 'ta_recommendation_v1'` then `readCacheSync('next-session')`; `:415-416` revalidates via `cachedFetch('next-session', '/api/next-session', NEXT_SESSION_TTL, …)`. `app/session-select/components/recommendation-card.tsx:163` links to `/session-explain?sessionId=<displaySession.id>`.
- `lib/types/program.ts:84-121` — `NextSessionRecommendation` already carries `scoredSessions`, `weightedComponents`, `signals`, `consecutiveTrainingDays`, `deloadOrRestRecommended`, `deloadStrength`, `hrvWarning` — everything `SessionExplainData` needs.
- `app/globals.css:308-345` — `pb-safe`, `pt-safe`, `pt-safe-or-4` (identical to `pt-safe`), `pb-safe-action`, `pb-nav-safe`, `pb-safe-action-lg` all exist.
- `lib/sqlite/cache.ts:10` `readCacheSync<T>`, `:101` `setCached<T>`, `:275` `cachedFetch<T>`. `lib/cache-ttl.ts:14` `NEXT_SESSION_TTL = TTL_SHORT`.
- `components/ui/collapsible.tsx` exists (Radix Collapsible primitive).
- Tests: `__tests__/` dirs with `*.test.ts`, vitest `environment: 'node'` (see `lib/**/__tests__/`).

---

### Task 1: TDD the pure `next-session` → explain-data mapper (honours `sessionId`)

Extract the page's `SessionExplainData` assembly (`primaryReason`, alternatives, contributor mapping) into a pure, node-testable helper that takes the cached `NextSessionRecommendation` plus an optional `sessionId` and returns the render data — the seed-lookup made deterministic and testable.

**Files:**
- Create: `lib/session-explain/build-explain-data.ts`
- Create: `lib/session-explain/__tests__/build-explain-data.test.ts`

- [ ] Write the test first. Create `lib/session-explain/__tests__/build-explain-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildSessionExplainData } from '../build-explain-data'
import type { NextSessionRecommendation } from '@/lib/types/program'
import type { ProgramSession } from '@/lib/types/program'

function sess(id: string, name: string): ProgramSession {
  return { id, name, position: 0, icon: null, exercises: [] } as unknown as ProgramSession
}

function rec(): NextSessionRecommendation {
  return {
    isRestDay: false,
    reason: 'x',
    session: sess('a', 'Pull'),
    consecutiveTrainingDays: 2,
    deloadOrRestRecommended: false,
    deloadStrength: undefined,
    hrvWarning: false,
    weightedComponents: {
      recovery:  { score: 80, weight: 0.5 },
      balance:   { score: 60, weight: 0.3 },
      freshness: { score: 90, weight: 0.2 },
    },
    scoredSessions: [
      { session: sess('a', 'Pull'), overallScore: 78, recoveryScore: 80, balanceScore: 60, freshnessScore: 90 },
      { session: sess('b', 'Push'), overallScore: 64, recoveryScore: 50, balanceScore: 55, freshnessScore: 88 },
      { session: sess('c', 'Legs'), overallScore: 61, recoveryScore: 70, balanceScore: 40, freshnessScore: 70 },
    ],
    signals: {
      muscleRecovery: [{ muscle: 'lats', pct: 0.8, hoursAgo: 40 }],
      ouraReadiness: 72, sleepTrend: 1.05, hrvTrend: 0.9,
      energyLevel: 'good', soreMuscles: ['chest'],
    },
  }
}

describe('buildSessionExplainData', () => {
  it('returns null when the recommendation lacks ai_dynamic scoring fields', () => {
    expect(buildSessionExplainData({ isRestDay: false, reason: 'x' }, undefined)).toBeNull()
    expect(buildSessionExplainData(null, undefined)).toBeNull()
  })

  it('uses the scored session matching the passed sessionId as the subject', () => {
    const d = buildSessionExplainData(rec(), 'b')!
    expect(d.session).toEqual({ id: 'b', name: 'Push' })
    expect(d.overallScore).toBe(64)
    // alternatives are every OTHER scored session
    expect(d.alternatives.map(a => a.session.id).sort()).toEqual(['a', 'c'])
  })

  it('falls back to the top-scored session when sessionId is missing or unknown', () => {
    expect(buildSessionExplainData(rec(), undefined)!.session.id).toBe('a')
    expect(buildSessionExplainData(rec(), 'zzz')!.session.id).toBe('a')
  })

  it('derives each alternative primaryReason from the largest deficit vs the subject', () => {
    const d = buildSessionExplainData(rec(), 'a')!
    const push = d.alternatives.find(a => a.session.id === 'b')!
    // vs a: recovery deficit 30, balance 5, freshness 2 → recovery is largest
    expect(push.primaryReason).toBe('muscles not fully recovered')
    const legs = d.alternatives.find(a => a.session.id === 'c')!
    // vs a: recovery 10, balance 20, freshness 20 → tie broken by first (balance)
    expect(legs.primaryReason).toBe('not yet overdue')
  })

  it('passes weighted components, signals and flags straight through', () => {
    const d = buildSessionExplainData(rec(), 'a')!
    expect(d.weightedComponents.recovery.score).toBe(80)
    expect(d.signals.ouraReadiness).toBe(72)
    expect(d.consecutiveTrainingDays).toBe(2)
    expect(d.hrvWarning).toBe(false)
  })
})
```

- [ ] Create `lib/session-explain/build-explain-data.ts` with the moved logic. Export the `SessionExplainData` type from here (the content component will re-import it):

```ts
import type { NextSessionRecommendation } from '@/lib/types/program'

export interface WeightedComponents {
  recovery:  { score: number; weight: number }
  balance:   { score: number; weight: number }
  freshness: { score: number; weight: number }
}

export interface ExplainSignals {
  muscleRecovery: Array<{ muscle: string; pct: number; hoursAgo: number }>
  ouraReadiness: number | null
  sleepTrend: number | null
  hrvTrend: number | null
  energyLevel: string | null
  soreMuscles: string[]
}

export interface ExplainAlternative {
  session: { id: string; name: string }
  overallScore: number
  primaryReason: string
}

export interface SessionExplainData {
  session: { id: string; name: string }
  overallScore: number
  weightedComponents: WeightedComponents
  signals: ExplainSignals
  consecutiveTrainingDays: number
  deloadOrRestRecommended: boolean
  deloadStrength: 'soft' | 'recommended' | 'strong' | null
  hrvWarning: boolean
  alternatives: ExplainAlternative[]
}

function primaryReason(deficits: { recovery: number; balance: number; freshness: number }): string {
  const labels: Record<string, string> = {
    recovery:  'muscles not fully recovered',
    balance:   'not yet overdue',
    freshness: 'trained too recently',
  }
  const key = Object.entries(deficits).sort(([, a], [, b]) => b - a)[0][0]
  return labels[key] ?? 'lower overall score'
}

/**
 * Maps a cached NextSessionRecommendation into the render data for the
 * "Why this?" page. `sessionId` (from the ?sessionId= param the Home card
 * passes) selects which scored session is the subject; when absent/unknown we
 * fall back to the top-scored session. Returns null when the recommendation
 * carries no ai_dynamic scoring fields (weekly/rotation programs have no
 * explanation to show).
 */
export function buildSessionExplainData(
  recommendation: NextSessionRecommendation | null | undefined,
  sessionId: string | undefined,
): SessionExplainData | null {
  if (
    !recommendation ||
    !recommendation.scoredSessions?.length ||
    !recommendation.signals ||
    !recommendation.weightedComponents
  ) {
    return null
  }

  const scored = recommendation.scoredSessions
  const subject = (sessionId && scored.find(s => s.session.id === sessionId)) || scored[0]

  const alternatives: ExplainAlternative[] = scored
    .filter(s => s.session.id !== subject.session.id)
    .map(s => ({
      session: { id: s.session.id, name: s.session.name },
      overallScore: s.overallScore,
      primaryReason: primaryReason({
        recovery:  subject.recoveryScore  - s.recoveryScore,
        balance:   subject.balanceScore   - s.balanceScore,
        freshness: subject.freshnessScore - s.freshnessScore,
      }),
    }))

  return {
    session: { id: subject.session.id, name: subject.session.name },
    overallScore: subject.overallScore,
    weightedComponents: recommendation.weightedComponents,
    signals: recommendation.signals,
    consecutiveTrainingDays: recommendation.consecutiveTrainingDays ?? 0,
    deloadOrRestRecommended: recommendation.deloadOrRestRecommended ?? false,
    deloadStrength: recommendation.deloadStrength ?? null,
    hrvWarning: recommendation.hrvWarning ?? false,
    alternatives,
  }
}
```

- [ ] Run `pnpm test lib/session-explain` and confirm the new tests pass. Run `pnpm tsc --noEmit`.

> Note: the original `page.tsx` used `scoredSessions[0]` as `best` and `slice(1)` as alternatives. The subject-selection change means alternatives are now "every scored session except the subject" rather than "all but the first" — behaviourally identical when `sessionId` is the top-scored session (the normal case), and correct when it isn't.

---

### Task 2: TDD the grouped-signals helper (reduce jargon, prioritise)

The raw signals render as 7 undifferentiated jargon cards. Add a pure helper that groups them into a small number of labelled sections with plain-language values, so the layout task (Task 6) can render grouped/collapsible signals without inline mapping logic.

**Files:**
- Create: `lib/session-explain/group-signals.ts`
- Create: `lib/session-explain/__tests__/group-signals.test.ts`

- [ ] Write the test first. Create `lib/session-explain/__tests__/group-signals.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { groupSignals } from '../group-signals'
import type { SessionExplainData } from '../build-explain-data'

const base: SessionExplainData = {
  session: { id: 'a', name: 'Pull' },
  overallScore: 78,
  weightedComponents: {
    recovery:  { score: 80, weight: 0.5 },
    balance:   { score: 60, weight: 0.3 },
    freshness: { score: 90, weight: 0.2 },
  },
  signals: {
    muscleRecovery: [], ouraReadiness: 72, sleepTrend: 1.05, hrvTrend: 0.9,
    energyLevel: 'good', soreMuscles: ['chest'],
  },
  consecutiveTrainingDays: 2,
  deloadOrRestRecommended: false, deloadStrength: null, hrvWarning: false,
  alternatives: [],
}

describe('groupSignals', () => {
  it('emits Readiness, Recovery and Body sections in a stable order', () => {
    const groups = groupSignals(base)
    expect(groups.map(g => g.heading)).toEqual(['Readiness', 'Recovery', 'Body'])
  })

  it('renders trends as plain language, not "% of baseline" jargon', () => {
    const rows = groupSignals(base).flatMap(g => g.rows)
    const sleep = rows.find(r => r.label === 'Sleep')!
    expect(sleep.value).toBe('Slightly above your usual')
    const hrv = rows.find(r => r.label === 'HRV')!
    expect(hrv.value).toBe('A little below your usual')
  })

  it('surfaces warning chips for a low HRV trend and a long training streak', () => {
    const rows = groupSignals({ ...base, hrvWarning: true, consecutiveTrainingDays: 5 }).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'HRV')!.chip).toEqual({ text: 'Below baseline', tone: 'warn' })
    expect(rows.find(r => r.label === 'Training streak')!.chip).toEqual({ text: 'Consider a rest day', tone: 'warn' })
  })

  it('shows "No data" for null signals and "None"/"Not logged" fallbacks', () => {
    const rows = groupSignals({
      ...base,
      signals: { ...base.signals, ouraReadiness: null, sleepTrend: null, hrvTrend: null, energyLevel: null, soreMuscles: [] },
    }).flatMap(g => g.rows)
    expect(rows.find(r => r.label === 'Oura readiness')!.value).toBe('No data')
    expect(rows.find(r => r.label === 'Sleep')!.value).toBe('No data')
    expect(rows.find(r => r.label === 'Energy')!.value).toBe('Not logged today')
    expect(rows.find(r => r.label === 'Sore muscles')!.value).toBe('None')
  })
})
```

- [ ] Create `lib/session-explain/group-signals.ts`:

```ts
import type { SessionExplainData } from './build-explain-data'

export type ChipTone = 'warn' | 'ok'
export interface SignalRow {
  label: string
  value: string
  chip?: { text: string; tone: ChipTone }
}
export interface SignalGroup {
  heading: string
  rows: SignalRow[]
}

const ENERGY_LABEL: Record<string, string> = {
  drained: 'Drained', low: 'Low energy', ok: 'OK', good: 'Good', pumped: 'Pumped',
}

function trendPhrase(ratio: number | null): string {
  if (ratio == null) return 'No data'
  if (ratio >= 1.1) return 'Well above your usual'
  if (ratio >= 1.02) return 'Slightly above your usual'
  if (ratio > 0.98) return 'About your usual'
  if (ratio > 0.9) return 'A little below your usual'
  return 'Well below your usual'
}

function readinessBand(score: number): string {
  return score >= 70 ? 'Good' : score >= 50 ? 'Fair' : 'Low'
}

/**
 * Groups the raw signals into a few plain-language sections for the demoted
 * "the numbers" area. The AI narrative up top is the primary "why"; this is the
 * evidence behind it, de-jargoned.
 */
export function groupSignals(data: SessionExplainData): SignalGroup[] {
  const { signals: s, consecutiveTrainingDays, hrvWarning } = data

  const readiness: SignalRow[] = [
    {
      label: 'Oura readiness',
      value: s.ouraReadiness != null ? `${s.ouraReadiness} · ${readinessBand(s.ouraReadiness)}` : 'No data',
    },
    { label: 'Sleep', value: trendPhrase(s.sleepTrend) },
    {
      label: 'HRV',
      value: trendPhrase(s.hrvTrend),
      chip: hrvWarning ? { text: 'Below baseline', tone: 'warn' } : undefined,
    },
  ]

  const recovery: SignalRow[] = [
    {
      label: 'Training streak',
      value: `${consecutiveTrainingDays} day${consecutiveTrainingDays === 1 ? '' : 's'} in a row`,
      chip: consecutiveTrainingDays >= 4 ? { text: 'Consider a rest day', tone: 'warn' } : undefined,
    },
    {
      label: 'Sore muscles',
      value: s.soreMuscles.length > 0 ? s.soreMuscles.join(', ') : 'None',
    },
  ]

  const body: SignalRow[] = [
    {
      label: 'Energy',
      value: s.energyLevel ? (ENERGY_LABEL[s.energyLevel] ?? s.energyLevel) : 'Not logged today',
    },
  ]

  return [
    { heading: 'Readiness', rows: readiness },
    { heading: 'Recovery', rows: recovery },
    { heading: 'Body', rows: body },
  ]
}
```

- [ ] Run `pnpm test lib/session-explain` — all four `groupSignals` tests plus Task 1's pass. Run `pnpm tsc --noEmit`.

---

### Task 3: Make the insight route cache-first off `sessionId` (kill the double recompute)

The insight route must not call `getNextSession` when the per-day insight is already cached. The `?sessionId=` param gives the cache section directly, so the cached path needs zero recompute.

**Files:**
- Modify: `app/api/session-explain/insight/route.ts:11-68`

- [ ] Rewrite the route so it reads `sessionId`, checks the cache first, and only recomputes on a miss. Full file:

```ts
import { google } from '@ai-sdk/google'
import { streamText } from 'ai'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { errorLog } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { DEFAULT_TZ, todayInTz } from '@/lib/date-utils'
import { textStreamResponse } from '@/lib/ai/stream'

export async function GET(req: Request) {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tz = session.user?.timezone ?? DEFAULT_TZ
    const today = todayInTz(tz)
    const repo = await getRepository()

    const sessionId = new URL(req.url).searchParams.get('sessionId')

    // Cache-first: when the caller passes the session id (the Home card always
    // does), we can serve the per-day cached narrative WITHOUT recomputing
    // getNextSession — the id is the only thing the cache key needs.
    if (sessionId) {
      const cached = await repo.getAiHealthInsight(userId, `session-explain:${sessionId}`, today)
      if (cached) {
        return new Response(cached, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      }
    }

    // Miss (or no sessionId): recompute the recommendation to build the prompt.
    const recommendation = await repo.getNextSession(userId, tz)
    if (!recommendation.session || !recommendation.signals || !recommendation.weightedComponents) {
      return NextResponse.json({ error: 'No AI dynamic recommendation available' }, { status: 404 })
    }

    const cacheSection = `session-explain:${recommendation.session.id}`
    // Re-check under the authoritative id in case the caller sent no/stale id.
    const cached = await repo.getAiHealthInsight(userId, cacheSection, today)
    if (cached) {
      return new Response(cached, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }

    if (!rateLimit(`session-explain:${userId}`, 20, 60 * 60 * 1000)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const sig = recommendation.signals
    const wc = recommendation.weightedComponents
    const sessionName = recommendation.session.name

    const prompt = `You are a concise personal training assistant. Explain in 2–3 sentences why ${sessionName} was chosen for today's workout.

Key signals:
- Muscle recovery: ${wc.recovery.score}% (weight ${Math.round(wc.recovery.weight * 100)}%)
- Session balance (how overdue): ${wc.balance.score}% (weight ${Math.round(wc.balance.weight * 100)}%)
- Freshness: ${wc.freshness.score}% (weight ${Math.round(wc.freshness.weight * 100)}%)
- Oura readiness: ${sig.ouraReadiness != null ? sig.ouraReadiness : 'not connected'}
- Sleep trend vs baseline: ${sig.sleepTrend != null ? `${Math.round(sig.sleepTrend * 100)}%` : 'no data'}
- HRV trend vs baseline: ${sig.hrvTrend != null ? `${Math.round(sig.hrvTrend * 100)}%` : 'no data'}
- Energy level: ${sig.energyLevel ?? 'not logged today'}
- Sore muscles: ${sig.soreMuscles.length > 0 ? sig.soreMuscles.join(', ') : 'none'}
- Consecutive training days: ${recommendation.consecutiveTrainingDays ?? 0}
- Deload recommended: ${recommendation.deloadOrRestRecommended ? `yes (${recommendation.deloadStrength})` : 'no'}

Write in second person. Be specific about which signals mattered. Do not use bullet points or headers.`

    const result = streamText({
      model: google('gemini-3.1-flash-lite'),
      prompt,
    })

    return textStreamResponse(result.textStream, {
      onComplete: text => repo.upsertAiHealthInsight(userId, cacheSection, today, text.trim()),
    })
  } catch (error) {
    const errMsg = errorLog(error, 'GET /api/session-explain/insight')
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}
```

- [ ] Constraint check: rate limit preserved (unchanged `20/hr`); streamed prose output stays as-is (no `generateObject` needed — CLAUDE.md exempts streamed narrative). No SWR `Cache-Control` header added — this is a streaming `text/plain` route, not a new JSON aggregate GET, so the SWR-header rule does not apply; the per-day DB cache is its freshness mechanism.
- [ ] `pnpm tsc --noEmit`, `pnpm lint`.

---

### Task 4: Seed the AI narrative from a client cache key (no skeleton on repeat visit)

The narrative card must paint last-known prose synchronously on a repeat visit and revalidate in the background, matching the app's instant-paint rule.

**Files:**
- Modify: `app/session-explain/components/ai-insight-card.tsx:1-59`

- [ ] Add a client cache seed keyed by `sessionId`, seed it in an effect (never a `useState` initializer — CLAUDE.md hydration rule), and write the final text on stream completion. Full file:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { SparklesIcon } from 'lucide-react'
import { splitStreamError } from '@/lib/ai/stream'
import { readCacheSync, setCached } from '@/lib/sqlite/cache'
import { TTL_LONG } from '@/lib/cache-ttl'

function cacheKey(sessionId: string) {
  return `session-explain-insight:${sessionId}`
}

export function AiInsightCard({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

  // Synchronous cache seed: paint last-known narrative before the stream lands.
  // Seeded in an effect (not a useState initializer) to avoid hydration drift.
  useEffect(() => {
    const seed = readCacheSync<string>(cacheKey(sessionId))
    if (seed) { setText(seed); setLoading(false) }
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    async function fetchInsight() {
      try {
        const res = await fetch(`/api/session-explain/insight?sessionId=${encodeURIComponent(sessionId)}`)
        if (!res.ok || !res.body) { setLoading(false); return }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let full = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          full += decoder.decode(value, { stream: true })
          const { text: clean, errored: hasError } = splitStreamError(full)
          setText(clean)
          if (hasError) setErrored(true)
        }
        const { text: finalClean, errored: finalError } = splitStreamError(full)
        if (!cancelled && finalClean && !finalError) {
          void setCached(cacheKey(sessionId), finalClean, TTL_LONG)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchInsight()
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <div
      className="rounded-xl border border-amber-500/30 p-4 space-y-2"
      style={{ background: 'color-mix(in oklch, rgba(245,158,11,0.08), transparent)' }}
    >
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-amber-400" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">Why this session</p>
      </div>
      {loading && !text ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 rounded bg-amber-500/20 w-full" />
          <div className="h-3 rounded bg-amber-500/20 w-4/5" />
          <div className="h-3 rounded bg-amber-500/20 w-3/5" />
        </div>
      ) : (
        <p className="text-sm leading-relaxed">{text || 'No insight available.'}</p>
      )}
      {errored && (
        <p className="text-xs text-destructive">The insight was cut short — check your connection and reopen this page to retry.</p>
      )}
    </div>
  )
}
```

> Notes: the seed makes a repeat same-day visit paint instantly with no skeleton. `TTL_LONG` (6 h) is fine — the server route remains the per-day authority and a fresh stream overwrites the seed each open. Label changed from "AI Insight" to "Why this session" (less jargon, matches the narrative-first framing); text colour promoted from `text-muted-foreground` to default foreground now that it's the lead element.

- [ ] **(Optional prewarm — implementer's discretion.)** To warm the *first-ever* open of the day, add a once-per-day fire-and-forget prewarm on the Home recommendation card so the server cache is populated before the user taps "Why this?". In `app/session-select/components/recommendation-card.tsx`, inside a `useEffect` gated by a `sessionStorage` day-flag, when `!isTrainedToday && recommendation?.session`, call `fetch('/api/session-explain/insight?sessionId=' + encodeURIComponent(displaySession.id)).catch(() => {})`. Guard so it fires at most once per session id per day (e.g. flag key `ta_explain_prewarm:<id>:<todayInTz()>`). Keep it out of the render path. If this feels like scope creep, skip it — Task 4's client seed already covers repeat visits; only the very first open stays cold.

- [ ] `pnpm tsc --noEmit`, `pnpm lint`.

---

### Task 5: Convert the page to auth-only server wrapper + cache-seeded client

Stop the server component from recomputing `getNextSession` on every open. `page.tsx` keeps only the auth guard; a new client component seeds from the `next-session` client cache and honours `?sessionId=`.

**Files:**
- Modify: `app/session-explain/page.tsx:1-57` (reduce to auth + render client)
- Create: `app/session-explain/session-explain-client.tsx`
- Modify: `app/session-explain/session-explain-content.tsx:34-44` (import `SessionExplainData` from the helper instead of re-declaring)

- [ ] Rewrite `app/session-explain/page.tsx` to only authenticate and render the client component (no `getNextSession`, no data assembly):

```tsx
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { SessionExplainClient } from './session-explain-client'

export default async function SessionExplainPage() {
  const session = await auth()
  if (!session?.user?.id) return notFound()
  return <SessionExplainClient />
}
```

- [ ] Create `app/session-explain/session-explain-client.tsx`. It seeds synchronously from the same keys the Home screen uses (`ta_recommendation_v1` sessionStorage, then `readCacheSync('next-session')`), builds the render data via the Task 1 helper honouring `?sessionId=`, and revalidates with `cachedFetch`:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { NextSessionRecommendation } from '@/lib/types/program'
import { readCacheSync, cachedFetch } from '@/lib/sqlite/cache'
import { NEXT_SESSION_TTL } from '@/lib/cache-ttl'
import { buildSessionExplainData, type SessionExplainData } from '@/lib/session-explain/build-explain-data'
import { SessionExplainContent } from './session-explain-content'
import { SessionExplainEmpty } from './components/session-explain-empty'

function readSeed(): NextSessionRecommendation | null {
  try {
    const raw = typeof window !== 'undefined' ? sessionStorage.getItem('ta_recommendation_v1') : null
    if (raw) return JSON.parse(raw) as NextSessionRecommendation
  } catch { /* fall through */ }
  return readCacheSync<NextSessionRecommendation>('next-session')
}

export function SessionExplainClient() {
  const searchParams = useSearchParams()
  const sessionId = searchParams.get('sessionId') ?? undefined
  const [rec, setRec] = useState<NextSessionRecommendation | null>(null)
  const [hydrated, setHydrated] = useState(false)

  // Synchronous cache seed (effect, not initializer — hydration safety).
  useEffect(() => {
    const seed = readSeed()
    if (seed) setRec(seed)
    setHydrated(true)
  }, [])

  // Background revalidate against the same key/TTL the Home screen uses.
  useEffect(() => {
    void cachedFetch<NextSessionRecommendation>(
      'next-session', '/api/next-session', NEXT_SESSION_TTL,
      (fresh) => setRec(fresh),
    )
  }, [])

  const data: SessionExplainData | null = rec ? buildSessionExplainData(rec, sessionId) : null

  if (data) return <SessionExplainContent data={data} />
  // Seeded but the program has no ai_dynamic explanation, or cache empty and
  // fetch still in flight → lightweight non-skeleton empty/loading state.
  return <SessionExplainEmpty loading={!hydrated || rec === null} />
}
```

- [ ] Create `app/session-explain/components/session-explain-empty.tsx` — a minimal safe-area-correct header + message (no jarring skeleton; used both while a cold cache fetch is in flight and when a non-ai_dynamic program has nothing to explain):

```tsx
'use client'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'

export function SessionExplainEmpty({ loading }: { loading: boolean }) {
  const router = useRouter()
  return (
    <div className="min-h-screen bg-page pb-safe">
      <div className="flex items-center gap-3 px-4 pt-safe pb-2">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-muted/40 active:scale-90 transition-transform"
          aria-label="Go back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Why this session?</h1>
      </div>
      <p className="px-4 pt-8 text-sm text-muted-foreground">
        {loading ? 'Loading your recommendation…' : 'No explanation is available for this session.'}
      </p>
    </div>
  )
}
```

- [ ] In `app/session-explain/session-explain-content.tsx`, delete the local `WeightedComponents`/`Signals`/`Alternative`/`SessionExplainData` interface block (`:13-44`) and import the type from the helper instead:

```tsx
import type { SessionExplainData } from '@/lib/session-explain/build-explain-data'
```

Keep the rest of the component's prop signature (`{ data }: { data: SessionExplainData }`) unchanged for now — Task 6 rewrites its body.

- [ ] `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`. Confirm the page compiles as a client-seeded route with no server-side `getNextSession`.

---

### Task 6: Safe-area + narrative-first layout rework

Add the missing insets and reorder so the narrative leads and the raw signals are grouped/demoted under a collapsible. **The exact visual arrangement (narrative-then-score vs score-then-narrative, collapsed-by-default vs expanded) is to be confirmed on-device — this task implements the confirmed narrative-first direction; fine-tune ordering after the S25 check.**

**Files:**
- Modify: `app/session-explain/session-explain-content.tsx:59-147` (reorder + safe-area)
- Create: `app/session-explain/components/signal-sections.tsx` (grouped/collapsible raw signals)

- [ ] Create `app/session-explain/components/signal-sections.tsx`, rendering the Task 2 groups inside the existing Radix `Collapsible` primitive (demoted "the numbers" behind a toggle with `aria-expanded` handled by the primitive):

```tsx
'use client'
import { useState } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { groupSignals } from '@/lib/session-explain/group-signals'
import type { SessionExplainData } from '@/lib/session-explain/build-explain-data'

const chipTone: Record<'warn' | 'ok', string> = {
  warn: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  ok:   'bg-green-500/15 text-green-400 border-green-500/30',
}

export function SignalSections({ data }: { data: SessionExplainData }) {
  const [open, setOpen] = useState(false)
  const groups = groupSignals(data)

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-card">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-semibold">The signals behind this</span>
        <ChevronDownIcon
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-4 pb-4 space-y-4">
        {groups.map(group => (
          <div key={group.heading} className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.heading}</p>
            {group.rows.map(row => (
              <div key={row.label} className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className="flex items-center gap-2 text-sm font-medium text-right">
                  {row.value}
                  {row.chip && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${chipTone[row.chip.tone]}`}>
                      {row.chip.text}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
```

- [ ] Rewrite `SessionExplainContent`'s body (`app/session-explain/session-explain-content.tsx:59-147`) — narrative first, safe-area insets, grouped signals. Replace the whole function (and drop the now-unused `SignalCard`, `ContributorBars`, per-signal icon imports and `ENERGY_*`/`trendLabel` helpers moved into `groupSignals`):

```tsx
'use client'
import { useRouter } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import type { SessionExplainData } from '@/lib/session-explain/build-explain-data'
import { ScoreRing } from './components/score-ring'
import { AlternativesCard } from './components/alternatives-card'
import { AiInsightCard } from './components/ai-insight-card'
import { SignalSections } from './components/signal-sections'

export function SessionExplainContent({ data }: { data: SessionExplainData }) {
  const router = useRouter()
  const { session, overallScore, alternatives } = data

  return (
    <div className="min-h-screen bg-page pb-safe">
      <div className="flex items-center gap-3 px-4 pt-safe pb-2">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-muted/40 active:scale-90 transition-transform"
          aria-label="Go back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Why {session.name}?</h1>
      </div>

      <div className="px-4 space-y-4 pb-10">
        {/* Narrative first — the readable "why", seeded from cache for instant paint. */}
        <AiInsightCard sessionId={session.id} />

        <ScoreRing score={overallScore} label="Overall readiness for this session" />

        {/* Raw signals grouped + demoted behind a collapsible. */}
        <SignalSections data={data} />

        <AlternativesCard alternatives={alternatives} />
      </div>
    </div>
  )
}
```

- [ ] Delete the now-dead component files if nothing else imports them: check with `grep -rn "ContributorBars\|SignalCard" app/` — `ContributorBars` and `SignalCard` are only used here. Remove `app/session-explain/components/contributor-bars.tsx` and `app/session-explain/components/signal-card.tsx` **only if** the grep confirms no other importers; otherwise leave them.
- [ ] Constraint checks: `pt-safe` is the sole `pt-*` on the header (not combined with another `pt-*` — CLAUDE.md); `pb-safe` on the root scroll container plus the inner `pb-10` breathing gap on a *different* element (no padding-bottom conflict); no inline `env()`; content file stays well under 800 lines (~50 lines now). Collapsible reuses the existing `components/ui/collapsible.tsx` primitive (real `aria-expanded`), not a hand-rolled toggle.
- [ ] `pnpm tsc --noEmit`, `pnpm lint`.

---

### Task 7: Verify & acceptance criteria

**Files:**
- Verify: `app/session-explain/*`, `app/api/session-explain/insight/route.ts`, `lib/session-explain/*`

- [ ] Run the full gate: `pnpm test`, `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` — all green.
- [ ] Start `pnpm dev` against the local dev DB (`test@local.dev`, program is ai_dynamic/PPL). Drive at **412×915** (Playwright or DevTools device frame):
  - **No double recompute:** tail the dev server logs while opening `/session-explain?sessionId=<id>` from Home. Confirm the page render issues **no** `getNextSession` server call (it seeds from the client cache; only the background `cachedFetch('next-session')` hits `/api/next-session`). Confirm the insight route logs **one** `getNextSession` only on the day's first (cache-miss) open, and **zero** on subsequent opens (cache hit returns immediately). Add a temporary `console.time`/log around `getNextSession` if needed, then remove it.
  - **Honours `sessionId`:** open with `?sessionId=` of a non-top alternative and confirm the subject session (title "Why <name>?", score ring, alternatives list) reflects that id, not always the top-scored one.
  - **Narrative first:** the AI "Why this session" card renders at the top, above the score ring and the collapsed "The signals behind this" section.
  - **No skeleton on repeat visit:** open the page once (let the narrative stream + cache), navigate away, reopen — the narrative paints immediately with no amber pulse skeleton; the recommendation data paints with no muted skeleton.
  - **Safe-area (sandbox limitation):** confirm `pt-safe`/`pb-safe` classes are present and resolve; note the web sandbox reports a **0** inset so the header won't visibly drop — **the real gate is the on-device APK check** (§ device note below).
- [ ] Run `pnpm test lib/session-explain` — `buildSessionExplainData` and `groupSignals` suites green.

**Acceptance criteria**
1. Opening "Why this?" from Home paints the narrative + score + signals from cache with **no load skeleton on a repeat same-day visit**.
2. The page performs **no server-side `getNextSession` recompute** on open; the insight route recomputes at most **once per day** (first, cache-miss open) and **zero times** on cached opens.
3. The `?sessionId=` param is honoured — the explained session matches the id passed by the Home card.
4. Header clears the status bar (`pt-safe`) and the bottom content clears the gesture bar (`pb-safe`); no inline `env()` anywhere on this page.
5. Layout is narrative-first: AI synthesis at the top, raw signals grouped and demoted under a collapsible with de-jargoned labels.
6. `pnpm test` / `tsc` / `lint` / `build` all pass; AI route keeps its rate limit; streamed prose remains a plain text stream (no `generateObject` needed).

**Device note (the real safe-area gate):** the web sandbox renders safe-area insets as **0**, so the header-under-status-bar fix and the exact narrative-first visual arrangement are **unverified until checked on the Samsung S25 Ultra APK**. Run `docs/device-smoke-checklist.md` for this screen: confirm (a) the back button + title sit fully below the status bar, (b) the bottom of the scroll clears the gesture bar, (c) the narrative-first ordering and collapsed-by-default signals read well in dark theme, and (d) whether the "The signals behind this" section should default open or collapsed. Adjust ordering/collapse-default after that on-device look — this plan implements the confirmed narrative-first direction but leaves the fine visual arrangement to on-device confirmation.

---

## Constraint compliance summary (CLAUDE.md)

- **Instant paint / no skeleton on repeat visit:** page seeds from `next-session` cache; narrative seeds from `session-explain-insight:<id>`; seeds run in effects, never `useState` initializers.
- **Cache keys:** reuses the existing `next-session` key + `NEXT_SESSION_TTL` (no duplicate key for the same data); new `session-explain-insight:<id>` key defined once with `TTL_LONG`. The narrative cache is read-only-ish (overwritten each stream); no cross-write invalidation group needed since it's derived per-day server-cached AI text, not mutable user data.
- **Safe-area:** canonical `pt-safe`/`pb-safe` utilities only; never combined with another `pt-*`/`pb-*` on the same element; no inline `env()`.
- **AI/security:** streamed prose narrative stays as a text stream (explicitly allowed — not structured output); rate limit preserved; no new bare `JSON.parse` of LLM output.
- **SWR headers:** none added — the insight route streams `text/plain` and is not a new JSON aggregate GET; `/api/next-session` already ships SWR headers.
- **File size / componentisation:** pure logic extracted to `lib/session-explain/*`; signal rendering extracted to `components/signal-sections.tsx`; content orchestrator drops to ~50 lines.
- **One formula, one place:** `primaryReason` + explain-data assembly now live once in `lib/session-explain/build-explain-data.ts` (removed from `page.tsx`); trend/energy labelling consolidated in `group-signals.ts`.
