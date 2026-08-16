# "Why This Session?" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend AI dynamic session scoring to use readiness/sleep/HRV signals, and build a full-screen "Why this?" detail page showing the composite score, contributor bars, per-signal cards, ranked alternatives, and a streaming Gemini explanation.

**Architecture:** Two parts ship together. Part 1 adds `sleepTrend`, `energyLevel`, `hrvTrend` to `AiDynamicInput` and shifts scoring weights when readiness or sleep is low. Part 2 adds a server-rendered `/session-explain` page that reads the enriched `NextSessionRecommendation` (which now carries `scoredSessions`, `weightedComponents`, `signals`) and renders it with a streaming AI insight card.

**Tech Stack:** TypeScript, Next.js 15 RSC + client components, Vercel AI SDK `streamText`, Gemini `gemini-3.1-flash-lite`, Tailwind CSS v4, Lucide icons, Drizzle ORM (read-only via existing repository).

---

## File map

| Action | File | Purpose |
|---|---|---|
| Modify | `lib/types/program.ts` | Add `weightedComponents`, `scoredSessions`, `signals`, `hrvWarning` to `NextSessionRecommendation` |
| Modify | `lib/ai-periodization/ai-dynamic.ts` | Add `sleepTrend`, `energyLevel`, `hrvTrend` to `AiDynamicInput`; update `computeAiDynamicNextSession` to use dynamic weights and return new fields |
| Modify | `lib/data/postgres/adapter.ts` | Fetch sleep sessions + body metrics in `getNextSession` ai_dynamic branch; pass new inputs; populate `signals` on return value |
| Modify | `lib/__tests__/ai-dynamic.test.ts` | Add `sleepTrend`, `energyLevel`, `hrvTrend` to `baseInput`; add tests for weight shift, energy deload bump, HRV warning |
| Create | `app/api/session-explain/insight/route.ts` | Streaming Gemini explanation |
| Create | `app/session-explain/components/score-ring.tsx` | Large SVG ring (0–100) |
| Create | `app/session-explain/components/contributor-bars.tsx` | Three weighted bars |
| Create | `app/session-explain/components/signal-card.tsx` | Generic icon + label + value card |
| Create | `app/session-explain/components/alternatives-card.tsx` | Ranked alternatives list |
| Create | `app/session-explain/components/ai-insight-card.tsx` | Streaming Gemini text card |
| Create | `app/session-explain/session-explain-content.tsx` | Client component — full page layout |
| Create | `app/session-explain/page.tsx` | RSC — fetches data, renders content |
| Modify | `app/session-select/components/recommendation-card.tsx` | Add "Why this?" button |

---

## Task 1: Extend type definitions

**Files:**
- Modify: `lib/types/program.ts`
- Modify: `lib/ai-periodization/ai-dynamic.ts`

- [ ] **Step 1: Add new optional fields to `NextSessionRecommendation` in `lib/types/program.ts`**

Replace the existing `NextSessionRecommendation` interface (lines 81–95):

```ts
export interface NextSessionRecommendation {
  isRestDay: boolean
  session?: ProgramSession
  reason: string
  reminderEnabled?: boolean
  reminderTime?: string | null
  // ai_dynamic only — undefined for weekly/rotation programs
  deloadOrRestRecommended?: boolean
  deloadStrength?: 'soft' | 'recommended' | 'strong'
  consecutiveTrainingDays?: number
  consecutiveRestDays?: number
  streakWarning?: boolean
  streakBroken?: boolean
  temperatureAlert?: boolean
  // Extended ai_dynamic scoring fields
  weightedComponents?: {
    recovery: { score: number; weight: number }
    balance: { score: number; weight: number }
    freshness: { score: number; weight: number }
  }
  scoredSessions?: Array<{
    session: ProgramSession
    overallScore: number
    recoveryScore: number
    balanceScore: number
    freshnessScore: number
  }>
  hrvWarning?: boolean
  // Signal data for the "Why this?" explain page
  signals?: {
    muscleRecovery: Array<{ muscle: string; pct: number; hoursAgo: number }>
    ouraReadiness: number | null
    sleepTrend: number | null
    hrvTrend: number | null
    energyLevel: string | null
    soreMuscles: string[]
  }
}
```

- [ ] **Step 2: Add `sleepTrend`, `energyLevel`, `hrvTrend` to `AiDynamicInput` in `lib/ai-periodization/ai-dynamic.ts`**

Replace the existing `AiDynamicInput` interface (lines 16–28):

```ts
export interface AiDynamicInput {
  sessions: ProgramSession[]
  muscleAssignments: Record<string, MuscleAssignment[]>
  muscleRecovery: MuscleRecovery[]
  history: SessionHistory[]
  soreMuscles: string[]
  readinessScore: number | null
  temperatureDeviation: number | null
  daySummary: string | null
  timezone: string
  reminderEnabled: boolean
  reminderTime: string | null
  sleepTrend: number | null
  energyLevel: string | null
  hrvTrend: number | null
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -40
```

Expected: errors only about callers of `computeAiDynamicNextSession` that don't yet pass the new fields — those get fixed in Tasks 3 and 4.

- [ ] **Step 4: Commit**

```bash
git add lib/types/program.ts lib/ai-periodization/ai-dynamic.ts
git commit -m "extend types: add scoring and explain fields to NextSessionRecommendation and AiDynamicInput"
```

---

## Task 2: Update `computeAiDynamicNextSession` logic

**Files:**
- Modify: `lib/ai-periodization/ai-dynamic.ts` (lines 171–228)

- [ ] **Step 1: Replace the `computeAiDynamicNextSession` function body**

The function signature stays the same. Replace everything from `export function computeAiDynamicNextSession` through the closing `}` with:

```ts
export function computeAiDynamicNextSession(input: AiDynamicInput): NextSessionRecommendation {
  const {
    sessions, muscleAssignments, muscleRecovery, history, soreMuscles,
    readinessScore, temperatureDeviation, daySummary, timezone,
    reminderEnabled, reminderTime, sleepTrend, energyLevel, hrvTrend,
  } = input

  const now = new Date()
  const rem = { reminderEnabled, reminderTime }

  if (sessions.length === 0) {
    return { isRestDay: false, reason: 'No sessions in program', ...rem }
  }

  // Already trained today — show today's session
  const todayStr = toAestDay(now, timezone)
  const todaySession = history.find(h => h.hasExercises && toAestDay(h.startedAt, timezone) === todayStr)
  if (todaySession) {
    const sess = sessions.find(s => s.name.toLowerCase() === todaySession.sessionName.toLowerCase())
    if (sess) return { isRestDay: false, session: sess, reason: `Already trained: ${sess.name}`, ...rem }
  }

  // Shift recovery weight up when readiness or sleep quality is low
  const lowReadiness = readinessScore != null && readinessScore < 60
  const lowSleep = sleepTrend != null && sleepTrend < 0.85
  const wRecovery = (lowReadiness || lowSleep) ? 0.55 : 0.40
  const wBalance  = (lowReadiness || lowSleep) ? 0.25 : 0.35
  const wFreshness = (lowReadiness || lowSleep) ? 0.20 : 0.25

  // Score every session and capture component scores for the explain page
  const scoredRaw = sessions.map(s => {
    const recoveryScore = sessionRecoveryScore(s, muscleAssignments, muscleRecovery, soreMuscles)
    const balanceScore  = sessionBalanceScore(s, sessions, history, now)
    const freshnessScore = sessionFreshnessScore(s, history, now)
    return {
      session: s,
      recoveryScore,
      balanceScore,
      freshnessScore,
      overallScore: recoveryScore * wRecovery + balanceScore * wBalance + freshnessScore * wFreshness,
    }
  }).sort((a, b) => b.overallScore - a.overallScore)

  const bestRaw = scoredRaw[0]
  const best = bestRaw.session
  const recovery = Math.round(bestRaw.recoveryScore)

  const consecutiveTrainingDays = countConsecutiveTrainingDays(history, now, timezone)
  const consecutiveRestDays = countConsecutiveRestDays(history, now, timezone)

  const deload = computeDeloadStrength(
    consecutiveTrainingDays, readinessScore, temperatureDeviation, daySummary,
  )
  let recommended = deload.recommended
  let strength = deload.strength

  // Energy level can push deload strength up one level or force 'strong'
  if (energyLevel === 'drained') {
    recommended = true
    strength = 'strong'
  } else if (energyLevel === 'low') {
    if (!recommended) {
      recommended = true
      strength = 'soft'
    } else if (strength === 'soft') {
      strength = 'recommended'
    } else if (strength === 'recommended') {
      strength = 'strong'
    }
  }

  const hrvWarning = hrvTrend != null && hrvTrend < 0.85

  const weightedComponents = {
    recovery:  { score: Math.round(bestRaw.recoveryScore),  weight: wRecovery },
    balance:   { score: Math.round(bestRaw.balanceScore),   weight: wBalance },
    freshness: { score: Math.round(bestRaw.freshnessScore), weight: wFreshness },
  }

  const scoredSessions = scoredRaw.map(s => ({
    session: s.session,
    overallScore:  Math.round(s.overallScore),
    recoveryScore: Math.round(s.recoveryScore),
    balanceScore:  Math.round(s.balanceScore),
    freshnessScore: Math.round(s.freshnessScore),
  }))

  const reason = `${best.name} · recovery ${recovery}% · ${consecutiveTrainingDays} training days`

  return {
    isRestDay: false,
    session: best,
    reason,
    deloadOrRestRecommended: recommended,
    deloadStrength: strength,
    consecutiveTrainingDays,
    consecutiveRestDays,
    streakWarning: consecutiveRestDays === 2,
    streakBroken: consecutiveRestDays >= 3,
    temperatureAlert: deload.temperatureAlert,
    weightedComponents,
    scoredSessions,
    hrvWarning,
    ...rem,
  }
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | grep "ai-dynamic" | head -20
```

Expected: no errors in `ai-dynamic.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/ai-periodization/ai-dynamic.ts
git commit -m "scoring: dynamic weights + energy deload bump + scoredSessions return"
```

---

## Task 3: Update the adapter's `getNextSession` for ai_dynamic mode

**Files:**
- Modify: `lib/data/postgres/adapter.ts` (lines 1188–1222)

This task adds sleep + HRV data fetching, computes `sleepTrend` and `hrvTrend`, passes them to `computeAiDynamicNextSession`, and attaches `signals` to the return value.

- [ ] **Step 1: Replace the ai_dynamic block in `getNextSession`**

Find the block starting at line 1188 (`// ── AI Dynamic mode ─`) and ending at the closing brace of `return computeAiDynamicNextSession(...)`. Replace it with:

```ts
    // ── AI Dynamic mode ────────────────────────────────────────────────────────
    if (program.phaseMode === 'ai_dynamic') {
      const todayIso = todayInTz(timezone)
      const from7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      const from14dStr = toAestDay(new Date(Date.now() - 14 * 86_400_000), timezone)

      const [muscleAssignmentsMap, ouraRows, moodLog, recentWorkouts, exerciseLibrary, sleepSessions, bodyMetrics] = await Promise.all([
        this.getExerciseMuscleAssignments(
          sessions.flatMap(s => s.exercises.map(e => e.exerciseName)),
        ),
        this.getOuraDaily(userId, todayIso, todayIso),
        this.getMoodLog(userId, todayIso),
        this.getWorkoutSessionsFrom(userId, from7d),
        this.listExerciseLibrary(),
        this.listSleepSessions(userId, from14dStr, todayIso),
        this.listBodyMetrics(userId, from14dStr, todayIso),
      ])

      const ouraToday = ouraRows[0] ?? null
      const history: AiDynamicInput['history'] = recentWsWithName.map(w => ({
        sessionName: w.sessionName ?? '',
        startedAt: w.startedAt,
        hasExercises: true,
      }))

      // Sleep trend: ratio of recent 3 nights vs older baseline
      let sleepTrend: number | null = null
      if (sleepSessions.length >= 4) {
        const sorted = [...sleepSessions].sort((a, b) => b.sleepEnd.getTime() - a.sleepEnd.getTime())
        const recent3 = sorted.slice(0, 3)
        const older = sorted.slice(3, 10)
        if (older.length > 0) {
          const recentAvg = recent3.reduce((s, sl) => s + (sl.durationHours ?? 0), 0) / recent3.length
          const olderAvg = older.reduce((s, sl) => s + (sl.durationHours ?? 0), 0) / older.length
          sleepTrend = olderAvg > 0 ? recentAvg / olderAvg : null
        }
      }

      // HRV trend: ratio of recent 3 days vs older baseline
      let hrvTrend: number | null = null
      const hrvRows = bodyMetrics.filter(m => m.hrvMs != null && m.hrvMs > 0)
      if (hrvRows.length >= 4) {
        const sorted = [...hrvRows].sort((a, b) => b.date.localeCompare(a.date))
        const recent3 = sorted.slice(0, 3)
        const older = sorted.slice(3, 10)
        if (older.length > 0) {
          const recentAvg = recent3.reduce((s, m) => s + m.hrvMs!, 0) / recent3.length
          const olderAvg = older.reduce((s, m) => s + m.hrvMs!, 0) / older.length
          hrvTrend = olderAvg > 0 ? recentAvg / olderAvg : null
        }
      }

      const muscleRecovery = computeMuscleRecovery(recentWorkouts, exerciseLibrary)

      const result = computeAiDynamicNextSession({
        sessions,
        muscleAssignments: muscleAssignmentsMap,
        muscleRecovery,
        history,
        soreMuscles: moodLog?.soreMuscles ?? [],
        readinessScore: ouraToday?.readinessScore ?? null,
        temperatureDeviation: ouraToday?.temperatureDeviation ?? null,
        daySummary: ouraToday?.daySummary ?? null,
        sleepTrend,
        energyLevel: moodLog?.energyLevel ?? null,
        hrvTrend,
        timezone,
        ...rem,
      })

      return {
        ...result,
        signals: {
          muscleRecovery,
          ouraReadiness: ouraToday?.readinessScore ?? null,
          sleepTrend,
          hrvTrend,
          energyLevel: moodLog?.energyLevel ?? null,
          soreMuscles: moodLog?.soreMuscles ?? [],
        },
      }
    }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/data/postgres/adapter.ts
git commit -m "adapter: fetch sleep/HRV for ai_dynamic, populate signals on recommendation"
```

---

## Task 4: Update and add tests

**Files:**
- Modify: `lib/__tests__/ai-dynamic.test.ts`

- [ ] **Step 1: Add new fields to `baseInput` in the test file**

Find `const baseInput: AiDynamicInput = {` and add the three new fields before the closing `}`:

```ts
const baseInput: AiDynamicInput = {
  sessions,
  muscleAssignments: {},
  muscleRecovery: [],
  history: [],
  soreMuscles: [],
  readinessScore: 80,
  temperatureDeviation: null,
  daySummary: null,
  timezone: 'Australia/Brisbane',
  reminderEnabled: false,
  reminderTime: null,
  sleepTrend: null,
  energyLevel: null,
  hrvTrend: null,
}
```

- [ ] **Step 2: Add tests for the new scoring and signaling behavior**

Append these test blocks after the existing `describe('computeAiDynamicNextSession'` tests (before the `describe('countConsecutiveTrainingDays'` block):

```ts
  it('shifts recovery weight when readiness is below 60', () => {
    // Push done 1 day ago, Legs 3 days ago — normally Legs wins on balance
    // But with low readiness, recovery weight rises: Push must have better recovery to win
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Pull exercise': [{ muscle: 'pull', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const muscleRecovery = [
      { muscle: 'push', pct: 95, hoursAgo: 24 },
      { muscle: 'pull', pct: 80, hoursAgo: 48 },
      { muscle: 'legs', pct: 30, hoursAgo: 72 },  // legs not recovered
    ]
    // With default weights (readiness 80): Legs wins on balance (most overdue)
    const resultHigh = computeAiDynamicNextSession({
      ...baseInput, history, muscleAssignments, muscleRecovery, readinessScore: 80,
    })
    expect(resultHigh.session?.name).toBe('Legs')

    // With low readiness (55): recovery weight bumps to 0.55 — Push (95%) should win
    const resultLow = computeAiDynamicNextSession({
      ...baseInput, history, muscleAssignments, muscleRecovery, readinessScore: 55,
    })
    expect(resultLow.session?.name).toBe('Push')
  })

  it('shifts recovery weight when sleepTrend is below 0.85', () => {
    const history = makeHistory(['Push', 'Pull', 'Legs'], [1, 2, 3])
    const muscleAssignments: Record<string, import('../types/program').MuscleAssignment[]> = {
      'Push exercise': [{ muscle: 'push', role: 'main' }],
      'Pull exercise': [{ muscle: 'pull', role: 'main' }],
      'Legs exercise': [{ muscle: 'legs', role: 'main' }],
    }
    const muscleRecovery = [
      { muscle: 'push', pct: 95, hoursAgo: 24 },
      { muscle: 'pull', pct: 80, hoursAgo: 48 },
      { muscle: 'legs', pct: 30, hoursAgo: 72 },
    ]
    const result = computeAiDynamicNextSession({
      ...baseInput, history, muscleAssignments, muscleRecovery, sleepTrend: 0.75,
    })
    // Poor sleep → recovery weight up → Push wins over Legs
    expect(result.session?.name).toBe('Push')
  })

  it('forces deloadStrength to strong when energyLevel is drained', () => {
    const history = makeHistory(['Push'], [1])
    const result = computeAiDynamicNextSession({ ...baseInput, history, energyLevel: 'drained' })
    expect(result.deloadOrRestRecommended).toBe(true)
    expect(result.deloadStrength).toBe('strong')
  })

  it('bumps deloadStrength one level when energyLevel is low', () => {
    // 4 consecutive days + high readiness → 'soft'; energy 'low' bumps to 'recommended'
    const history = makeHistory(['Push', 'Pull', 'Legs', 'Push'], [1, 2, 3, 4])
    const result = computeAiDynamicNextSession({
      ...baseInput, history, readinessScore: 75, energyLevel: 'low',
    })
    expect(result.deloadStrength).toBe('recommended')
  })

  it('sets hrvWarning true when hrvTrend is below 0.85', () => {
    const result = computeAiDynamicNextSession({ ...baseInput, hrvTrend: 0.80 })
    expect(result.hrvWarning).toBe(true)
  })

  it('does not set hrvWarning when hrvTrend is null', () => {
    const result = computeAiDynamicNextSession({ ...baseInput, hrvTrend: null })
    expect(result.hrvWarning).toBe(false)
  })

  it('returns weightedComponents and scoredSessions', () => {
    const result = computeAiDynamicNextSession(baseInput)
    expect(result.weightedComponents).toBeDefined()
    expect(result.weightedComponents?.recovery.weight).toBe(0.40)
    expect(result.scoredSessions).toBeDefined()
    expect(result.scoredSessions?.length).toBe(3)
  })

  it('uses elevated weights when readiness is low', () => {
    const result = computeAiDynamicNextSession({ ...baseInput, readinessScore: 50 })
    expect(result.weightedComponents?.recovery.weight).toBe(0.55)
    expect(result.weightedComponents?.balance.weight).toBe(0.25)
    expect(result.weightedComponents?.freshness.weight).toBe(0.20)
  })
```

- [ ] **Step 3: Run the full test suite**

```bash
cd /home/user/TrainingAI && pnpm exec vitest run lib/__tests__/ai-dynamic.test.ts 2>&1
```

Expected: all tests pass (including existing ones).

- [ ] **Step 4: Commit**

```bash
git add lib/__tests__/ai-dynamic.test.ts
git commit -m "test: cover weight shift, energy deload bump, HRV warning, scoredSessions"
```

---

## Task 5: Create streaming insight API route

**Files:**
- Create: `app/api/session-explain/insight/route.ts`

- [ ] **Step 1: Create the streaming route**

```ts
// app/api/session-explain/insight/route.ts
import { google } from '@ai-sdk/google'
import { streamText } from 'ai'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { errorLog } from '@/lib/logger'
import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tz = session.user?.timezone ?? 'Australia/Brisbane'
    const recommendation = await (await getRepository()).getNextSession(userId, tz)

    if (!recommendation.session || !recommendation.signals || !recommendation.weightedComponents) {
      return NextResponse.json({ error: 'No AI dynamic recommendation available' }, { status: 404 })
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

    return new Response(result.textStream.pipeThrough(new TextEncoderStream()), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (error) {
    const errMsg = errorLog(error, 'GET /api/session-explain/insight')
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | grep "session-explain" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/session-explain/insight/route.ts
git commit -m "feat: streaming Gemini insight route for session explain"
```

---

## Task 6: Create UI components

**Files:**
- Create: `app/session-explain/components/score-ring.tsx`
- Create: `app/session-explain/components/contributor-bars.tsx`
- Create: `app/session-explain/components/signal-card.tsx`
- Create: `app/session-explain/components/alternatives-card.tsx`
- Create: `app/session-explain/components/ai-insight-card.tsx`

- [ ] **Step 1: Create `score-ring.tsx`**

```tsx
// app/session-explain/components/score-ring.tsx

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export function ScoreRing({ score, label }: { score: number; label: string }) {
  const r = 54
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - score / 100)
  const color = scoreColor(score)

  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <div className="relative w-36 h-36">
        <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 132 132">
          <circle cx="66" cy="66" r={r} fill="none" strokeWidth="10" className="stroke-muted/30" />
          <circle
            cx="66" cy="66" r={r} fill="none" strokeWidth="10"
            style={{
              stroke: color,
              strokeDasharray: circumference,
              strokeDashoffset: offset,
              strokeLinecap: 'round',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-bold tabular-nums" style={{ color }}>{score}</span>
          <span className="text-xs text-muted-foreground">/100</span>
        </div>
      </div>
      <p className="text-sm text-center text-muted-foreground px-4">{label}</p>
    </div>
  )
}
```

- [ ] **Step 2: Create `contributor-bars.tsx`**

```tsx
// app/session-explain/components/contributor-bars.tsx

interface Contributor {
  label: string
  score: number
  weight: number
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export function ContributorBars({ contributors }: { contributors: Contributor[] }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-4">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Scoring breakdown
      </p>
      {contributors.map(({ label, score, weight }) => {
        const color = scoreColor(score)
        return (
          <div key={label} className="space-y-1.5">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{label}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">×{Math.round(weight * 100)}%</span>
                <span className="font-bold tabular-nums" style={{ color }}>{score}%</span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full bg-muted/60 overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${score}%`, background: color }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Create `signal-card.tsx`**

```tsx
// app/session-explain/components/signal-card.tsx
import type { ReactNode } from 'react'

type ChipColor = 'amber' | 'red' | 'green'

interface SignalCardProps {
  icon: ReactNode
  label: string
  value: string
  sublabel?: string
  chip?: { text: string; color: ChipColor }
}

const chipClasses: Record<ChipColor, string> = {
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  red:   'bg-red-500/15 text-red-400 border-red-500/30',
  green: 'bg-green-500/15 text-green-400 border-green-500/30',
}

export function SignalCard({ icon, label, value, sublabel, chip }: SignalCardProps) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 flex items-center gap-4">
      <div className="flex-none text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-semibold mt-0.5 truncate">{value}</p>
        {sublabel && <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>}
      </div>
      {chip && (
        <span className={`flex-none text-[10px] font-semibold px-2 py-0.5 rounded-full border ${chipClasses[chip.color]}`}>
          {chip.text}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Create `alternatives-card.tsx`**

```tsx
// app/session-explain/components/alternatives-card.tsx

interface Alternative {
  session: { id: string; name: string }
  overallScore: number
  primaryReason: string
}

function scoreColor(score: number): string {
  if (score >= 70) return '#22c55e'
  if (score >= 40) return '#f59e0b'
  return '#ef4444'
}

export function AlternativesCard({ alternatives }: { alternatives: Alternative[] }) {
  if (alternatives.length === 0) return null
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Alternatives</p>
      {alternatives.map(alt => (
        <div key={alt.session.id} className="flex items-center gap-3">
          <span className="font-medium flex-1 truncate">{alt.session.name}</span>
          <span className="text-xs text-muted-foreground truncate">{alt.primaryReason}</span>
          <span
            className="flex-none font-bold tabular-nums text-sm w-7 text-right"
            style={{ color: scoreColor(alt.overallScore) }}
          >
            {alt.overallScore}
          </span>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Create `ai-insight-card.tsx`**

```tsx
// app/session-explain/components/ai-insight-card.tsx
'use client'
import { useEffect, useState } from 'react'
import { SparklesIcon } from 'lucide-react'

export function AiInsightCard({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function fetchInsight() {
      try {
        const res = await fetch(`/api/session-explain/insight?sessionId=${encodeURIComponent(sessionId)}`)
        if (!res.ok || !res.body) { setLoading(false); return }
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        while (true) {
          const { done, value } = await reader.read()
          if (done || cancelled) break
          setText(prev => prev + decoder.decode(value, { stream: true }))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchInsight()
    return () => { cancelled = true }
  }, [sessionId])

  return (
    <div className="rounded-xl border border-amber-500/30 p-4 space-y-2"
      style={{ background: 'color-mix(in oklch, rgba(245,158,11,0.08), transparent)' }}>
      <div className="flex items-center gap-2">
        <SparklesIcon className="h-4 w-4 text-amber-400" />
        <p className="text-[10px] font-bold uppercase tracking-wider text-amber-400">AI Insight</p>
      </div>
      {loading && !text ? (
        <div className="space-y-2 animate-pulse">
          <div className="h-3 rounded bg-amber-500/20 w-full" />
          <div className="h-3 rounded bg-amber-500/20 w-4/5" />
          <div className="h-3 rounded bg-amber-500/20 w-3/5" />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground leading-relaxed">{text || 'No insight available.'}</p>
      )}
    </div>
  )
}
```

- [ ] **Step 6: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | grep "session-explain" | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/session-explain/components/
git commit -m "feat: score ring, contributor bars, signal card, alternatives card, AI insight card"
```

---

## Task 7: Create the session-explain page

**Files:**
- Create: `app/session-explain/session-explain-content.tsx`
- Create: `app/session-explain/page.tsx`

- [ ] **Step 1: Create `session-explain-content.tsx`**

```tsx
// app/session-explain/session-explain-content.tsx
'use client'
import { useRouter } from 'next/navigation'
import {
  ArrowLeftIcon, ActivityIcon, MoonIcon, ZapIcon,
  HeartIcon, AlertTriangleIcon, FlameIcon,
} from 'lucide-react'
import { ScoreRing } from './components/score-ring'
import { ContributorBars } from './components/contributor-bars'
import { SignalCard } from './components/signal-card'
import { AlternativesCard } from './components/alternatives-card'
import { AiInsightCard } from './components/ai-insight-card'

interface WeightedComponents {
  recovery:  { score: number; weight: number }
  balance:   { score: number; weight: number }
  freshness: { score: number; weight: number }
}

interface Signals {
  muscleRecovery: Array<{ muscle: string; pct: number; hoursAgo: number }>
  ouraReadiness: number | null
  sleepTrend: number | null
  hrvTrend: number | null
  energyLevel: string | null
  soreMuscles: string[]
}

interface Alternative {
  session: { id: string; name: string }
  overallScore: number
  primaryReason: string
}

export interface SessionExplainData {
  session: { id: string; name: string }
  overallScore: number
  weightedComponents: WeightedComponents
  signals: Signals
  consecutiveTrainingDays: number
  deloadOrRestRecommended: boolean
  deloadStrength: 'soft' | 'recommended' | 'strong' | null
  hrvWarning: boolean
  alternatives: Alternative[]
}

const ENERGY_EMOJI: Record<string, string> = {
  drained: '😴', low: '😑', ok: '😐', good: '😊', pumped: '⚡',
}
const ENERGY_LABEL: Record<string, string> = {
  drained: 'Drained', low: 'Low energy', ok: 'OK', good: 'Good', pumped: 'Pumped',
}

function trendLabel(ratio: number | null): string {
  if (ratio == null) return 'No data'
  const pct = Math.round(ratio * 100)
  return `${pct}% of baseline ${ratio >= 1 ? '↑' : '↓'}`
}

export function SessionExplainContent({ data }: { data: SessionExplainData }) {
  const router = useRouter()
  const { session, overallScore, weightedComponents, signals, alternatives,
          consecutiveTrainingDays, deloadOrRestRecommended, deloadStrength, hrvWarning } = data

  const contributors = [
    { label: 'Muscle recovery', score: weightedComponents.recovery.score,  weight: weightedComponents.recovery.weight },
    { label: 'Session balance',  score: weightedComponents.balance.score,   weight: weightedComponents.balance.weight },
    { label: 'Freshness',        score: weightedComponents.freshness.score, weight: weightedComponents.freshness.weight },
  ]

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-safe-or-4 pt-4 pb-2">
        <button
          onClick={() => router.back()}
          className="p-2 -ml-2 rounded-full hover:bg-muted/40 active:scale-90 transition-transform"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-bold">Why {session.name}?</h1>
      </div>

      {/* Score ring */}
      <ScoreRing score={overallScore} label="Overall readiness for this session" />

      {/* Content */}
      <div className="px-4 space-y-3 pb-10">
        <ContributorBars contributors={contributors} />

        <SignalCard
          icon={<ActivityIcon />}
          label="Oura Readiness"
          value={signals.ouraReadiness != null ? String(signals.ouraReadiness) : 'No data'}
          sublabel={signals.ouraReadiness != null
            ? signals.ouraReadiness >= 70 ? 'Good' : signals.ouraReadiness >= 50 ? 'Fair' : 'Low'
            : undefined}
        />

        <SignalCard
          icon={<MoonIcon />}
          label="Sleep trend (14 days)"
          value={trendLabel(signals.sleepTrend)}
        />

        <SignalCard
          icon={<HeartIcon />}
          label="HRV trend (14 days)"
          value={trendLabel(signals.hrvTrend)}
          chip={hrvWarning ? { text: 'Below baseline', color: 'amber' } : undefined}
        />

        <SignalCard
          icon={<ZapIcon />}
          label="Energy level"
          value={signals.energyLevel
            ? `${ENERGY_EMOJI[signals.energyLevel] ?? ''} ${ENERGY_LABEL[signals.energyLevel] ?? signals.energyLevel}`
            : 'Not logged today'}
        />

        <SignalCard
          icon={<FlameIcon />}
          label="Sore muscles"
          value={signals.soreMuscles.length > 0 ? signals.soreMuscles.join(', ') : 'None'}
        />

        <SignalCard
          icon={<AlertTriangleIcon />}
          label="Consecutive training days"
          value={String(consecutiveTrainingDays)}
          chip={consecutiveTrainingDays >= 4 ? { text: 'Consider a rest day', color: 'amber' } : undefined}
        />

        {deloadOrRestRecommended && deloadStrength !== 'soft' && (
          <SignalCard
            icon={<AlertTriangleIcon />}
            label="Deload recommendation"
            value={deloadStrength === 'strong' ? 'Strong deload advised' : 'Deload recommended'}
            chip={{ text: deloadStrength ?? 'recommended', color: 'amber' }}
          />
        )}

        <AlternativesCard alternatives={alternatives} />

        <AiInsightCard sessionId={session.id} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create `page.tsx`**

```tsx
// app/session-explain/page.tsx
import { notFound } from 'next/navigation'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { SessionExplainContent, type SessionExplainData } from './session-explain-content'

function primaryReason(
  deficits: { recovery: number; balance: number; freshness: number },
): string {
  const labels: Record<string, string> = {
    recovery: 'muscles not fully recovered',
    balance:  'not yet overdue',
    freshness: 'trained too recently',
  }
  const key = (Object.entries(deficits).sort(([, a], [, b]) => b - a)[0][0])
  return labels[key] ?? 'lower overall score'
}

export default async function SessionExplainPage() {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return notFound()

  const tz = session.user?.timezone ?? 'Australia/Brisbane'
  const recommendation = await (await getRepository()).getNextSession(userId, tz)

  if (
    !recommendation.session ||
    !recommendation.scoredSessions?.length ||
    !recommendation.signals ||
    !recommendation.weightedComponents
  ) {
    return notFound()
  }

  const best = recommendation.scoredSessions[0]
  const alternatives = recommendation.scoredSessions.slice(1).map(s => ({
    session: { id: s.session.id, name: s.session.name },
    overallScore: s.overallScore,
    primaryReason: primaryReason({
      recovery:  best.recoveryScore  - s.recoveryScore,
      balance:   best.balanceScore   - s.balanceScore,
      freshness: best.freshnessScore - s.freshnessScore,
    }),
  }))

  const data: SessionExplainData = {
    session: { id: recommendation.session.id, name: recommendation.session.name },
    overallScore: best.overallScore,
    weightedComponents: recommendation.weightedComponents,
    signals: recommendation.signals,
    consecutiveTrainingDays: recommendation.consecutiveTrainingDays ?? 0,
    deloadOrRestRecommended: recommendation.deloadOrRestRecommended ?? false,
    deloadStrength: recommendation.deloadStrength ?? null,
    hrvWarning: recommendation.hrvWarning ?? false,
    alternatives,
  }

  return <SessionExplainContent data={data} />
}
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | grep "session-explain" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/session-explain/
git commit -m "feat: session-explain page with score ring, signals, and streaming AI insight"
```

---

## Task 8: Add "Why this?" entry point to RecommendationCard

**Files:**
- Modify: `app/session-select/components/recommendation-card.tsx`

- [ ] **Step 1: Add the import for `Link` at the top of the file**

After the existing imports, add:

```ts
import Link from 'next/link'
```

- [ ] **Step 2: Add the "Why this?" button**

In `recommendation-card.tsx`, find the block that renders the session name and supporting info (around line 152–170). The `displaySession.name` heading line looks like:

```tsx
<p className="font-bold text-2xl leading-tight truncate">{displaySession.name}</p>
```

Add a "Why this?" link immediately after the name paragraph, inside the same flex container. Replace:

```tsx
          <div className="flex items-center gap-3 min-w-0">
            {(() => {
              const Icon = getSessionIcon(displaySession.icon, displaySession.position);
              return <Icon className="h-8 w-8 flex-none" style={{ color: _rtColor }} />;
            })()}
            <p className="font-bold text-2xl leading-tight truncate">{displaySession.name}</p>
          </div>
```

with:

```tsx
          <div className="flex items-center gap-3 min-w-0">
            {(() => {
              const Icon = getSessionIcon(displaySession.icon, displaySession.position);
              return <Icon className="h-8 w-8 flex-none" style={{ color: _rtColor }} />;
            })()}
            <div className="flex flex-col min-w-0">
              <p className="font-bold text-2xl leading-tight truncate">{displaySession.name}</p>
              {!isTrainedToday && recommendation?.session && (
                <Link
                  href={`/session-explain?sessionId=${encodeURIComponent(displaySession.id)}`}
                  className="text-xs text-muted-foreground/70 hover:text-muted-foreground mt-0.5 w-fit"
                  onClick={e => e.stopPropagation()}
                >
                  Why this? →
                </Link>
              )}
            </div>
          </div>
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/user/TrainingAI && npx tsc --noEmit 2>&1 | grep "recommendation-card" | head -10
```

Expected: no errors.

- [ ] **Step 4: Run the full test suite to catch regressions**

```bash
cd /home/user/TrainingAI && pnpm exec vitest run 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 5: Commit and push**

```bash
git add app/session-select/components/recommendation-card.tsx
git commit -m "feat: add 'Why this?' link on RecommendationCard when session is recommended"
git push -u origin claude/training-schedule-logic-vwst0l
```

---

## Self-review checklist

**Spec coverage:**

| Spec requirement | Covered by |
|---|---|
| `sleepTrend` + `energyLevel` + `hrvTrend` added to `AiDynamicInput` | Task 1 |
| Weight shift: readiness < 60 or sleepTrend < 0.85 → recovery 0.55/balance 0.25/freshness 0.20 | Task 2 |
| `energyLevel === 'drained'` forces deloadStrength to `'strong'` | Task 2 |
| `energyLevel === 'low'` bumps deloadStrength one level | Task 2 |
| `hrvWarning` flag when hrvTrend < 0.85 | Task 2 |
| `weightedComponents` and `scoredSessions` returned from scoring function | Task 2 |
| Adapter fetches sleep + HRV data, passes new fields, populates `signals` | Task 3 |
| Tests for weight shift, energy deload, HRV warning | Task 4 |
| Streaming Gemini insight endpoint | Task 5 |
| Score ring component | Task 6 |
| Contributor bars (3 bars with weight labels) | Task 6 |
| Signal cards (readiness, sleep, HRV, energy, sore muscles, training days) | Task 6, 7 |
| Ranked alternatives card with primary reason | Task 6, 7 |
| AI insight card with streaming + loading skeleton | Task 6 |
| Full-screen page at `/session-explain` | Task 7 |
| "Why this?" entry point on RecommendationCard | Task 8 |
| Only shown when session is recommended (not rest day, not trained today) | Task 8 |

**Type consistency check:**
- `SessionExplainData` in `session-explain-content.tsx` matches what `page.tsx` builds from `NextSessionRecommendation`
- `signals` field on `NextSessionRecommendation` matches what the adapter assigns
- `AiDynamicInput.energyLevel` typed as `string | null` (not `EnergyLevel | null`) to avoid importing mood types into the pure scoring module — matches what the adapter passes (`moodLog?.energyLevel ?? null` where moodLog.energyLevel is `EnergyLevel`)
- `weightedComponents` property names (`recovery`, `balance`, `freshness`) consistent across `ai-dynamic.ts`, `program.ts`, and `session-explain-content.tsx`
