# Batch E — AI Usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every AI route structurally reliable and cheap: schema-constrained output via `generateObject` on the five hand-parsed routes (E1), DB-cached weekly-digest and session-explain responses reusing the `ai_health_insights` pattern plus wiring the orphaned weekly-digest route to its consumer (E2), AI-chat upgraded in two stages — recovery/wellness context + precomputed 1RM injection, then a read-only tool-calling loop replacing the 10 KB static data dump (E3), prompt hygiene across generate-program/builder-chat/health-insight/nutrition-scan (E4), and mid-stream error handling + a shared jittered-retry helper (E5).

**Architecture:** All AI calls stay on `gemini-3.1-flash-lite` via `@ai-sdk/google`. New shared server helpers live in `lib/ai/` (`retry.ts`, `stream.ts`) and `lib/ai-chat/` (`context.ts`, `tools.ts`); nutrition summing/sanitising moves to `lib/nutrition/scan-totals.ts` so it is unit-testable. Caching reuses the existing `ai_health_insights` table (`getAiHealthInsight`/`upsertAiHealthInsight` — `section` is TEXT, so composite keys like `session-explain:{programSessionId}` and `weekly-digest` fit; **no new migration needed**, migration `105_ai_response_cache.sql` stays reserved-unused). Streaming routes wrap `result.textStream` in a `ReadableStream` that appends a terminal error marker on failure; clients strip/detect it. Guiding principle: deterministic math in code, LLM only for judgment, schema-validated output, cached result.

**Tech Stack:** Next.js 15 App Router route handlers, `ai@6.0.214` + `@ai-sdk/google@3.0.86` (per `pnpm-lock.yaml` — **`node_modules` is stale at ai@5.0.192, run `pnpm install --frozen-lockfile` first**), `zod@4`, Drizzle/pg repository (`lib/data/repository.ts`, interface `WorkoutRepository`), vitest, pnpm.

**AI SDK API used in this plan (valid for the installed ai@6.x, and identical in 5.x):** `generateObject({ model, schema, system, prompt, maxRetries })` → `{ object }`, throws `NoObjectGeneratedError`; `streamText({ model, system, messages, tools, stopWhen })` → `result.textStream: AsyncIterable<string>`; `tool({ description, inputSchema, execute })` (**`inputSchema`, not `parameters`** — `parameters` was removed after v4); `stopWhen: stepCountIs(n)` (**not `maxSteps`**, removed in v5); `APICallError` / `NoObjectGeneratedError` exported from `'ai'` with static `.isInstance()`.

**Explicit exclusions (stated per plan scope):**
- Quick-win 6 — rate limits on `prescribe` and `session-explain/insight` (NOT in this plan).
- Quick-win 7 — `morning-briefing` caching by `(userId, date)` (NOT in this plan; `app/api/morning-briefing/route.ts` is only read as a format reference).
- E6 — proactive cron layer (separate batch).
- D3 — durable Postgres-backed rate limiter (Batch D).
- C-batch prompt-content fixes (e.g. the misstated ACWR gate text at `lib/ai-periodization/prompt.ts:143` is C5 — do not touch here).

---

### Task 1: Sync dependencies + shared retry helper `lib/ai/retry.ts` (E5)

**Files:**
- Create: `lib/ai/retry.ts`
- Create: `lib/__tests__/ai-retry.test.ts`

- [ ] **Step 1.1: Sync `node_modules` to the lockfile** (it currently holds ai@5.0.192; the lockfile pins 6.0.214):

```bash
cd /home/user/TrainingAI && pnpm install --frozen-lockfile
node -e "console.log(require('ai/package.json').version)"   # must print 6.0.214
```

- [ ] **Step 1.2: Create `lib/ai/retry.ts`** — exactly this content:

```ts
import { APICallError, NoObjectGeneratedError } from 'ai'

// Retryable = transient provider failures: rate limit or server error.
export function isRetryableAiError(err: unknown): boolean {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode
    return status === 429 || (status != null && status >= 500)
  }
  return false
}

// generateObject additionally fails when the model's output doesn't satisfy the
// schema — a single re-roll usually fixes it on flash-lite.
export function isRetryableObjectError(err: unknown): boolean {
  return isRetryableAiError(err) || NoObjectGeneratedError.isInstance(err)
}

export interface AiRetryOptions {
  baseDelayMs?: number
  jitterMs?: number
  shouldRetry?: (err: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
}

// Exactly one jittered retry. Callers pass maxRetries: 0 to the SDK call so the
// retry policy lives in one place instead of multiplying with the SDK's default 2.
export async function withAiRetry<T>(fn: () => Promise<T>, opts: AiRetryOptions = {}): Promise<T> {
  const {
    baseDelayMs = 1000,
    jitterMs = 500,
    shouldRetry = isRetryableAiError,
    sleep = ms => new Promise(r => setTimeout(r, ms)),
  } = opts
  try {
    return await fn()
  } catch (err) {
    if (!shouldRetry(err)) throw err
    await sleep(baseDelayMs + Math.random() * jitterMs)
    return fn()
  }
}
```

- [ ] **Step 1.3: Create `lib/__tests__/ai-retry.test.ts`**:

```ts
import { describe, it, expect, vi } from 'vitest'
import { APICallError, NoObjectGeneratedError } from 'ai'
import { withAiRetry, isRetryableAiError, isRetryableObjectError } from '@/lib/ai/retry'

const noSleep = () => Promise.resolve()

function apiError(statusCode: number) {
  return new APICallError({
    message: `status ${statusCode}`,
    url: 'https://example.test',
    requestBodyValues: {},
    statusCode,
  })
}

describe('isRetryableAiError', () => {
  it('is true for 429 and 5xx APICallErrors', () => {
    expect(isRetryableAiError(apiError(429))).toBe(true)
    expect(isRetryableAiError(apiError(500))).toBe(true)
    expect(isRetryableAiError(apiError(503))).toBe(true)
  })
  it('is false for 4xx (non-429) and plain errors', () => {
    expect(isRetryableAiError(apiError(400))).toBe(false)
    expect(isRetryableAiError(new Error('boom'))).toBe(false)
  })
})

describe('isRetryableObjectError', () => {
  it('additionally accepts NoObjectGeneratedError', () => {
    const err = new NoObjectGeneratedError({ message: 'schema mismatch' })
    expect(isRetryableObjectError(err)).toBe(true)
    expect(isRetryableObjectError(new Error('boom'))).toBe(false)
  })
})

describe('withAiRetry', () => {
  it('retries once on a retryable error then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(apiError(429))
      .mockResolvedValueOnce('ok')
    await expect(withAiRetry(fn, { sleep: noSleep })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('bad request'))
    await expect(withAiRetry(fn, { sleep: noSleep })).rejects.toThrow('bad request')
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('gives up after the second failure', async () => {
    const fn = vi.fn().mockRejectedValue(apiError(500))
    await expect(withAiRetry(fn, { sleep: noSleep })).rejects.toThrow()
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('waits a jittered delay before retrying', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined)
    const fn = vi.fn().mockRejectedValueOnce(apiError(429)).mockResolvedValueOnce('ok')
    await withAiRetry(fn, { sleep, baseDelayMs: 100, jitterMs: 50 })
    expect(sleep).toHaveBeenCalledTimes(1)
    const ms = sleep.mock.calls[0][0] as number
    expect(ms).toBeGreaterThanOrEqual(100)
    expect(ms).toBeLessThanOrEqual(150)
  })
})
```

If the `NoObjectGeneratedError` constructor signature differs in the installed version (check `node_modules/ai/dist/index.d.ts` for `class NoObjectGeneratedError`), adjust only the test's construction call — the helper itself uses `.isInstance()` and needs no change.

- [ ] **Step 1.4: Run and commit**

```bash
pnpm test lib/__tests__/ai-retry.test.ts && pnpm lint
git checkout -b feat/batch-e-ai-usage
git add lib/ai/retry.ts lib/__tests__/ai-retry.test.ts
git commit -m "Add shared one-shot jittered retry for AI calls

429/5xx and schema-validation failures from Gemini were surfacing straight
to users as 500s; a single re-roll fixes the vast majority."
```

---

### Task 2: Stream error-marker helper `lib/ai/stream.ts` (E5)

**Files:**
- Create: `lib/ai/stream.ts`
- Create: `lib/__tests__/ai-stream.test.ts`

- [ ] **Step 2.1: Create `lib/ai/stream.ts`** — client-safe (no imports from `'ai'` or server modules), so the marker constant and splitter can be imported by client components:

```ts
// Terminal marker appended when a text stream dies mid-flight (e.g. a 429 or
// provider error after tokens have already been sent). Clients strip it and
// surface an error state instead of showing a silent half-sentence.
export const AI_STREAM_ERROR_MARKER = '\n[[AI_STREAM_ERROR]]'

export function splitStreamError(text: string): { text: string; errored: boolean } {
  const idx = text.indexOf(AI_STREAM_ERROR_MARKER)
  if (idx === -1) return { text, errored: false }
  return { text: text.slice(0, idx).trimEnd(), errored: true }
}

// Wraps an AI SDK textStream into a plain-text Response. On mid-stream error the
// marker is emitted and the stream closed cleanly (HTTP status is already 200 by
// then — the marker is the only way to signal failure). onComplete runs inside
// the stream (before close) only on full success, so DB cache writes are
// guaranteed to finish before the response ends.
export function textStreamResponse(
  textStream: AsyncIterable<string>,
  opts: { onComplete?: (fullText: string) => Promise<void> } = {},
): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let full = ''
      try {
        for await (const chunk of textStream) {
          full += chunk
          controller.enqueue(encoder.encode(chunk))
        }
        if (opts.onComplete) {
          try { await opts.onComplete(full) } catch (err) {
            console.error('[ai-stream] onComplete failed:', String(err).slice(0, 200))
          }
        }
      } catch (err) {
        console.error('[ai-stream] mid-stream error:', String(err).slice(0, 200))
        controller.enqueue(encoder.encode(AI_STREAM_ERROR_MARKER))
      } finally {
        controller.close()
      }
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
```

- [ ] **Step 2.2: Create `lib/__tests__/ai-stream.test.ts`**:

```ts
import { describe, it, expect, vi } from 'vitest'
import { textStreamResponse, splitStreamError, AI_STREAM_ERROR_MARKER } from '@/lib/ai/stream'

async function* okStream() { yield 'Hello '; yield 'world' }
async function* failingStream() { yield 'Hello '; throw new Error('provider 429') }

async function readAll(res: Response): Promise<string> {
  return await res.text()
}

describe('textStreamResponse', () => {
  it('passes chunks through and calls onComplete with the full text', async () => {
    const onComplete = vi.fn().mockResolvedValue(undefined)
    const body = await readAll(textStreamResponse(okStream(), { onComplete }))
    expect(body).toBe('Hello world')
    expect(onComplete).toHaveBeenCalledWith('Hello world')
  })
  it('emits the error marker on mid-stream failure and skips onComplete', async () => {
    const onComplete = vi.fn()
    const body = await readAll(textStreamResponse(failingStream(), { onComplete }))
    expect(body).toBe('Hello ' + AI_STREAM_ERROR_MARKER)
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe('splitStreamError', () => {
  it('detects and strips the marker', () => {
    expect(splitStreamError('partial text ' + AI_STREAM_ERROR_MARKER)).toEqual({ text: 'partial text', errored: true })
  })
  it('leaves clean text alone', () => {
    expect(splitStreamError('all good')).toEqual({ text: 'all good', errored: false })
  })
})
```

- [ ] **Step 2.3: Run and commit**

```bash
pnpm test lib/__tests__/ai-stream.test.ts && pnpm lint
git add lib/ai/stream.ts lib/__tests__/ai-stream.test.ts
git commit -m "Add stream wrapper that signals mid-stream AI failures

A provider error after the first token previously ended the stream silently,
leaving a half-sentence with no way for the client to tell."
```

---

### Task 3: `exercises/generate` → `generateObject` (E1)

**Files:**
- Modify: `app/api/exercises/generate/route.ts`

- [ ] **Step 3.1: Rewrite the route.** Replace the whole file body with (keep the existing `RequestSchema` and auth/rate-limit blocks — shown in full for clarity):

```ts
import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/auth'
import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { rateLimit } from '@/lib/rate-limit'
import { withAiRetry, isRetryableObjectError } from '@/lib/ai/retry'
import { z } from 'zod'

const RequestSchema = z.object({
  name: z.string().min(1).max(120),
})

const MUSCLES = ['Chest', 'Shoulders', 'Triceps', 'Biceps', 'Forearms', 'Upper Back', 'Lats', 'Lower Back', 'Traps', 'Core', 'Quads', 'Hamstrings', 'Glutes', 'Calves', 'Adductors'] as const
const EQUIPMENT = ['barbell', 'dumbbell', 'cable', 'kettlebell', 'machine', 'bodyweight'] as const

const ExerciseGenSchema = z.object({
  normalizedName: z.string(),
  instructions: z.string(),
  muscles: z.array(z.object({ muscle: z.enum(MUSCLES), role: z.enum(['main', 'secondary']) })).min(1),
  equipment: z.array(z.enum(EQUIPMENT)).min(1),
})

const SYSTEM_PROMPT = `You are a fitness expert. Given an exercise name, return:
- normalizedName: the full proper name in Title Case — expand abbreviations (DB → Dumbbell, BB → Barbell, RDL → Romanian Deadlift, OHP → Overhead Press, etc.). If the input doesn't already specify equipment, prefix the name with the single most common equipment used to perform it (e.g. "Hip Thrust" → "Barbell Hip Thrust", "Bicep Curl" → "Dumbbell Bicep Curl", "Lateral Raise" → "Dumbbell Lateral Raise", "Leg Press" → "Machine Leg Press"). Only omit the prefix for exercises that are inherently bodyweight (e.g. "Push-Up", "Pull-Up", "Plank").
- instructions: 2-4 sentences explaining setup, form cues, and execution
- muscles: each with role "main" or "secondary"
- equipment: the equipment matching the name's prefix must be listed first. Only add further entries if the exercise is commonly performed interchangeably with near-identical form on that equipment (e.g. dumbbell/kettlebell goblet squats).`

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`exercise-gen:${session.user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 })
  }

  const body = RequestSchema.safeParse(await req.json())
  if (!body.success) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  try {
    const { object } = await withAiRetry(
      () => generateObject({
        model: google('gemini-3.1-flash-lite'),
        schema: ExerciseGenSchema,
        system: SYSTEM_PROMPT,
        prompt: `Exercise name: "${body.data.name}"`,
        maxRetries: 0,
      }),
      { shouldRetry: isRetryableObjectError },
    )
    return NextResponse.json(object)
  } catch {
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 })
  }
}
```

Note what changed: `generateText` + bare `JSON.parse` → schema-constrained `generateObject`; the "Return ONLY valid JSON. No markdown…" instruction is deleted (the schema enforces it); muscle names and equipment become `z.enum`s so the model literally cannot return an off-list value; one jittered retry on 429/5xx/schema-failure.

- [ ] **Step 3.2: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep "exercises/generate" ; pnpm test
git add app/api/exercises/generate/route.ts
git commit -m "Constrain exercise generation with generateObject

Bare JSON.parse of free text failed whenever the model added prose or fences;
the response schema also pins muscle/equipment names to the app's vocabulary."
```

**Manual verification (after Task 14's dev server is up, or now):** log in at `http://localhost:3000` as `test@local.dev` / `testpass123`, open the exercise library "add exercise" flow, type `db ohp` and generate — expect `normalizedName: "Dumbbell Overhead Press"` (or similar), muscles only from the 15-name list. **Malformed-model simulation:** temporarily add `.max(1)` to `instructions` in `ExerciseGenSchema`… actually to force `NoObjectGeneratedError` change the model id to `google('gemini-3.1-flash-lite')` → an invalid id like `google('no-such-model')` and confirm the route returns `{ error: 'Generation failed' }` with status 500 after two attempts (watch the server log for the retry). Revert before committing.

---

### Task 4: `nutrition/scan` → `generateObject` + deterministic ingredient summing (E1 + E4)

**Files:**
- Create: `lib/nutrition/scan-totals.ts` (move `sanitiseNutrition` here + new `sumIngredients`)
- Create: `lib/__tests__/scan-totals.test.ts`
- Modify: `app/api/nutrition/scan/route.ts`

- [ ] **Step 4.1: Create `lib/nutrition/scan-totals.ts`.** Move `RawNutrition`, `clamp`, `pos`, `sanitiseNutrition` verbatim from the route (lines 113–202 of the current file), export `sanitiseNutrition` and the `RawNutrition` interface, and add:

```ts
import type { NutritionIngredient } from '@/lib/types/nutrition'

// Deterministic totals from the per-ingredient breakdown. The model no longer
// self-verifies its arithmetic — we do the sums. Calories prefer the model's
// per-100g figures (they can encode fibre/alcohol nuance) but fall back to
// Atwater when they disagree with the macros by more than 40%.
export function sumIngredients(ingredients: NutritionIngredient[]): {
  servingSizeG: number
  calories: number
  proteinG: number
  carbsG: number
  fatG: number
} {
  let servingSizeG = 0, proteinG = 0, carbsG = 0, fatG = 0, calFromPer100 = 0
  for (const ing of ingredients) {
    const w = Math.max(0, Number(ing.weightG) || 0)
    servingSizeG += w
    proteinG     += Math.max(0, Number(ing.proteinPer100g)  || 0) * w / 100
    carbsG       += Math.max(0, Number(ing.carbsPer100g)    || 0) * w / 100
    fatG         += Math.max(0, Number(ing.fatPer100g)      || 0) * w / 100
    calFromPer100 += Math.max(0, Number(ing.caloriesPer100g) || 0) * w / 100
  }
  const atwater = proteinG * 4 + carbsG * 4 + fatG * 9
  const calories = calFromPer100 > 0 && Math.abs(calFromPer100 - atwater) / Math.max(atwater, 1) <= 0.4
    ? calFromPer100
    : atwater
  return {
    servingSizeG: Math.round(servingSizeG),
    calories: Math.round(calories),
    proteinG: Math.round(proteinG * 10) / 10,
    carbsG: Math.round(carbsG * 10) / 10,
    fatG: Math.round(fatG * 10) / 10,
  }
}
```

- [ ] **Step 4.2: Create `lib/__tests__/scan-totals.test.ts`**:

```ts
import { describe, it, expect } from 'vitest'
import { sumIngredients, sanitiseNutrition } from '@/lib/nutrition/scan-totals'

describe('sumIngredients', () => {
  it('sums weights and per-100g macros', () => {
    const totals = sumIngredients([
      { name: 'chicken', weightG: 150, caloriesPer100g: 165, proteinPer100g: 31, carbsPer100g: 0, fatPer100g: 3.6 },
      { name: 'rice',    weightG: 200, caloriesPer100g: 130, proteinPer100g: 2.7, carbsPer100g: 28, fatPer100g: 0.3 },
    ])
    expect(totals.servingSizeG).toBe(350)
    expect(totals.proteinG).toBeCloseTo(51.9, 1)   // 46.5 + 5.4
    expect(totals.carbsG).toBeCloseTo(56, 1)
    expect(totals.fatG).toBeCloseTo(6, 1)
    expect(totals.calories).toBe(508)              // 247.5 + 260, within 40% of Atwater
  })
  it('falls back to Atwater when per-100g calories are wildly off', () => {
    const totals = sumIngredients([
      { name: 'banana', weightG: 100, caloriesPer100g: 900, proteinPer100g: 1, carbsPer100g: 23, fatPer100g: 0.3 },
    ])
    // Atwater: 1*4 + 23*4 + 0.3*9 = 98.7 → model's 900 rejected
    expect(totals.calories).toBe(99)
  })
  it('handles a single-ingredient simple food and negative garbage', () => {
    const totals = sumIngredients([
      { name: 'bar', weightG: -60, caloriesPer100g: 400, proteinPer100g: 30, carbsPer100g: 40, fatPer100g: 10 },
    ])
    expect(totals.servingSizeG).toBe(0)
    expect(totals.calories).toBe(0)
  })
})

describe('sanitiseNutrition (moved, behaviour unchanged)', () => {
  it('recalculates calories from macros when deviation exceeds 40%', () => {
    const out = sanitiseNutrition({ servingSizeG: 100, calories: 900, proteinG: 10, carbsG: 10, fatG: 2 })
    expect(out.calories).toBe(98)   // 10*4 + 10*4 + 2*9
    expect(out.confidence).toBe('low')
  })
  it('caps saturated fat at total fat', () => {
    const out = sanitiseNutrition({ servingSizeG: 100, calories: 180, proteinG: 0, carbsG: 0, fatG: 20, satFatG: 35 })
    expect(out.satFatG).toBeLessThanOrEqual(out.fatG!)
  })
})
```

- [ ] **Step 4.3: Rewrite `app/api/nutrition/scan/route.ts`.** Keep auth, rate limit, image-size check, region hint, and text sanitisation exactly as they are. Replace the model call + parsing:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { google } from '@ai-sdk/google'
import { generateObject } from 'ai'
import { rateLimit } from '@/lib/rate-limit'
import { withAiRetry, isRetryableObjectError } from '@/lib/ai/retry'
import { sumIngredients, sanitiseNutrition } from '@/lib/nutrition/scan-totals'
import { z } from 'zod'

const REGION_CONTEXT: Record<string, string> = {
  AU: 'Assume products from Australian supermarkets (Coles, Woolworths, Aldi) where applicable.',
  US: "Assume products from US supermarkets (Walmart, Kroger, Whole Foods) where applicable.",
  UK: "Assume products from UK supermarkets (Tesco, Sainsbury's, ASDA) where applicable.",
  NZ: 'Assume products from New Zealand supermarkets (Countdown, Pak\'nSave, New World) where applicable.',
}

const IngredientSchema = z.object({
  name: z.string(),
  weightG: z.number(),
  caloriesPer100g: z.number(),
  proteinPer100g: z.number(),
  carbsPer100g: z.number(),
  fatPer100g: z.number(),
})

const ScanSchema = z.object({
  identified: z.boolean(),
  name: z.string(),
  brand: z.string().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  notes: z.string().nullable(),
  fiberG: z.number(),
  sugarG: z.number(),
  sodiumMg: z.number(),
  satFatG: z.number(),
  ingredients: z.array(IngredientSchema),
})
```

New system prompt (replaces `JSON_SHAPE` and the old three rules — the self-verify rule 3 is **deleted**, ingredients are now **always required**):

```ts
  const systemPrompt = `You are a nutrition expert. ${regionHint}
Rules:
1. Estimate for the EXACT portion described — not per 100g. If the user says "200g", the ingredient weights must total 200g. If no weight is given, use a typical single serving.
2. ALWAYS populate "ingredients" — one entry per component with its estimated weight in grams and its per-100g calories/protein/carbs/fat. For a simple single food (a banana, a protein bar) return exactly one ingredient covering the whole portion. Totals are computed from this list, so the weights and per-100g values are what matter.
3. fiberG, sugarG, sodiumMg, satFatG are for the whole portion.
4. If you cannot identify any food, set identified=false and leave ingredients empty.`
```

Replace both `generateText` calls with `generateObject` (same message/prompt structure, adding `schema: ScanSchema` and `maxRetries: 0`, wrapped in `withAiRetry(..., { shouldRetry: isRetryableObjectError })`), then replace the entire tail parsing block (`const cleaned = result.text.replace(...)` etc.) with:

```ts
  const scan = result.object
  if (!scan.identified || scan.ingredients.length === 0) {
    return NextResponse.json({ error: 'Could not identify food' })
  }

  const totals = sumIngredients(scan.ingredients)
  return NextResponse.json(sanitiseNutrition({
    name: scan.name,
    brand: scan.brand ?? undefined,
    servingSizeG: totals.servingSizeG,
    calories: totals.calories,
    proteinG: totals.proteinG,
    carbsG: totals.carbsG,
    fatG: totals.fatG,
    fiberG: scan.fiberG,
    sugarG: scan.sugarG,
    sodiumMg: scan.sodiumMg,
    satFatG: scan.satFatG,
    confidence: scan.confidence,
    notes: scan.notes ?? undefined,
    ingredients: scan.ingredients,
  }))
```

(Where `result` is `const result = await withAiRetry(() => generateObject({ ... }), { shouldRetry: isRetryableObjectError })` inside the existing try/catch that returns 502 on failure. The `{ error: 'AI returned unparseable response' }` catch block is deleted — unparseable output is now impossible; schema failure lands in the 502 catch.)

- [ ] **Step 4.4: Verify + commit**

```bash
pnpm test lib/__tests__/scan-totals.test.ts && pnpm lint && npx tsc --noEmit 2>&1 | grep -E "nutrition/scan|scan-totals"
git add lib/nutrition/scan-totals.ts lib/__tests__/scan-totals.test.ts app/api/nutrition/scan/route.ts
git commit -m "Compute scan nutrition totals from ingredients instead of trusting the model

The self-verify instruction was unreliable; now the model only supplies the
per-ingredient breakdown and the totals are summed deterministically, with the
existing Atwater sanitiser as the final clamp."
```

**Manual verification:** on the dev server, Nutrition tab → scan/describe food → type `200g chicken breast with 150g white rice`. Expect a result whose `servingSizeG` ≈ 350 and calories ≈ 500–560, with per-ingredient rows. Then type `asdfghjkl` — expect the "Could not identify food" path, not a crash.

---

### Task 5: `builder-chat` → `generateObject` + prompt hygiene (E1 + E4)

**Files:**
- Modify: `app/api/builder-chat/route.ts`

- [ ] **Step 5.1: Add the output schema** (below `RequestSchema`):

```ts
const BuilderExerciseSchema = z.object({
  name: z.string(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  progressionStyleName: z.string(),
  mainMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
})

const BuilderChatObjectSchema = z.object({
  response: z.string(),
  program: z.object({
    name: z.string(),
    sessions: z.array(z.object({
      name: z.string(),
      icon: z.string(),
      exercises: z.array(BuilderExerciseSchema),
    })),
  }),
})
```

- [ ] **Step 5.2: Prompt hygiene.** Three changes to the prompt construction:

**(a)** Exercise library as compact lines — replace

```ts
// BEFORE (route line ~67-73 and the JSON.stringify at ~127)
  const availableExercises = allExercises
    .filter(ex => ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e.toLowerCase())))
    .map(ex => ({
      name: ex.name,
      muscles: ex.muscles.map(m => `${m.muscle} (${m.role})`).join(', '),
      equipment: ex.equipment.map(e => EQUIPMENT_LABEL[e.toLowerCase()] ?? e).join(', '),
    }))
...
Available exercises (filtered by user's equipment):
${JSON.stringify(availableExercises, null, 2)}
```

with

```ts
// AFTER — one pipe-delimited line per exercise (~70% fewer tokens)
  const availableExercises = allExercises
    .filter(ex => ex.equipment.length === 0 || ex.equipment.some(e => equipmentSet.has(e.toLowerCase())))
    .map(ex =>
      `${ex.name}|${ex.muscles.map(m => `${m.muscle}(${m.role})`).join(',')}|${ex.equipment.map(e => EQUIPMENT_LABEL[e.toLowerCase()] ?? e).join(',')}`)
    .join('\n')
...
Available exercises (name|muscles|equipment), filtered by user's equipment:
${availableExercises}
```

**(b)** Compact program JSON — in the user prompt replace `${JSON.stringify(program, null, 2)}` with `${JSON.stringify(program)}`.

**(c)** Replace the per-role ALWAYS-style block. The server re-enforces `GOAL_STYLE_RULES` after the call (route lines ~168–196 stay untouched), so the prompt only needs one informational line. Replace the `goalStyleNote` construction:

```ts
// BEFORE
  const goalStyleNote = goal && GOAL_STYLE_RULES[goal]
    ? `The user's selected goal is "${goalLabel}". Progression styles for this goal:\n` +
      `- Primary compound: "${GOAL_STYLE_RULES[goal].primary}"\n` +
      `- Secondary compound: "${GOAL_STYLE_RULES[goal].secondary}"\n` +
      `- Accessory: "${GOAL_STYLE_RULES[goal].accessory}"`
    : 'Keep all progressionStyleName values exactly as they are in the current program.'
```

```ts
// AFTER — styles are corrected server-side; the model just needs valid names
  const goalStyleNote = goal && GOAL_STYLE_RULES[goal]
    ? `The user's goal is "${goalLabel}". Styles are assigned server-side by role (primary "${GOAL_STYLE_RULES[goal].primary}", secondary "${GOAL_STYLE_RULES[goal].secondary}", accessory "${GOAL_STYLE_RULES[goal].accessory}") — set progressionStyleName to those names and never invent others.`
    : 'Keep all progressionStyleName values exactly as they are in the current program.'
```

Also delete the last sentence of the system prompt (`Return your response as JSON with two fields... Return ONLY valid JSON, no markdown.`) and the final `Return JSON: { "response": string, "program": ... }` sentence of the user prompt — replace the latter with: `Each exercise in the returned program must include progressionStyleName (exact name from the list) and exerciseRole.`

- [ ] **Step 5.3: Swap the call and delete hand-parsing.** Replace:

```ts
// BEFORE (lines ~144-156)
    const { text } = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: systemPrompt,
      prompt: userPrompt,
    })

    let raw: { response?: string; program?: GeneratedProgram }
    try {
      raw = JSON.parse(text)
    } catch {
      console.error('[builder-chat] Failed to parse Gemini JSON:', text.slice(0, 500))
      return NextResponse.json({ error: 'Failed to process request. Please try again.' }, { status: 500 })
    }
```

```ts
// AFTER
    const { object: raw } = await withAiRetry(
      () => generateObject({
        model: google('gemini-3.1-flash-lite'),
        schema: BuilderChatObjectSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
      { shouldRetry: isRetryableObjectError },
    )
```

Imports change: `generateText` → `generateObject`; add `import { withAiRetry, isRetryableObjectError } from '@/lib/ai/retry'`. The downstream merge code (`raw.program?.sessions ?? program.sessions`, style re-enforcement, muscle lookup override) keeps working — `raw.program` is now always present and typed, so you may drop the `?.`/`?? 'Done!'` fallbacks (`raw.response ?? 'Done!'` → `raw.response`). The `...program, ...raw.program` spread still carries through non-schema fields (`phaseStructureName`, `phaseSetId`, `phases`, `reasoning`) from the client's program object. Keep the outer try/catch → 500.

- [ ] **Step 5.4: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep "builder-chat" ; pnpm test
git add app/api/builder-chat/route.ts
git commit -m "Schema-constrain builder chat and slim its prompt

The route stripped markdown fences before parsing — proof the model disobeyed
the JSON instruction. generateObject removes that class of failure; the exercise
library moves to pipe-delimited lines and the program is no longer pretty-printed."
```

**Manual verification:** dev server → program builder → generate a program → in the chat step ask `swap barbell bench press for dumbbell bench press`. Expect a conversational reply + updated program; check the server log for zero parse errors. Styles on primary/secondary exercises must still match the goal's `GOAL_STYLE_RULES` (server enforcement intact).

---

### Task 6: `generate-program` → `generateObject` + prompt hygiene (E1 + E4)

**Files:**
- Modify: `app/api/generate-program/route.ts`

- [ ] **Step 6.1: Add the output schema** (near `RequestSchema`; reuses nothing from builder-chat — this route has its own `reasoning` field and no `response`):

```ts
const GeneratedExerciseSchema = z.object({
  name: z.string(),
  exerciseRole: z.enum(['primary', 'secondary', 'accessory']),
  progressionStyleName: z.string(),
  mainMuscles: z.array(z.string()),
  secondaryMuscles: z.array(z.string()),
})

const GeneratedProgramSchema = z.object({
  name: z.string(),
  sessions: z.array(z.object({
    name: z.string(),
    icon: z.string(),
    exercises: z.array(GeneratedExerciseSchema),
  })),
  reasoning: z.string(),
})
```

- [ ] **Step 6.2: Prompt hygiene.**

**(a)** System prompt — delete the JSON instruction:

```ts
// BEFORE
  const systemPrompt = `You are an expert strength and conditioning coach designing programs for optimal muscle growth and strength. Generate a structured workout program as JSON. Return ONLY valid JSON — no markdown, no code fences, no extra text.`
// AFTER
  const systemPrompt = `You are an expert strength and conditioning coach designing programs for optimal muscle growth and strength.`
```

**(b)** Delete the entire per-goal ALWAYS block (`Style selection rules:` — the four-way ternary spanning current lines ~258–277) and the `- Peak phase programs: prefer "Peak 4-set" ...` line. `GOAL_STYLE_RULES` enforcement at lines ~411–424 overrides all of it server-side anyway. Replace with:

```ts
Style assignment (informational — the server enforces styles by role for this goal):
- primary compounds get "${GOAL_STYLE_RULES[inputs.goal].primary}", secondary compounds "${GOAL_STYLE_RULES[inputs.goal].secondary}", accessories "${GOAL_STYLE_RULES[inputs.goal].accessory}".
- Set progressionStyleName accordingly and use those styles' time estimates when fitting the session time budget.
```

**(c)** Exercise library as compact lines — replace the `exerciseList` construction (~lines 177–181) and its `JSON.stringify(exerciseList, null, 2)` use (~line 318):

```ts
  const exerciseList = filteredExercises.map(ex =>
    `${ex.name}|${ex.muscles.map(m => `${m.muscle}(${m.role})`).join(',')}|${ex.equipment.map(e => EQUIPMENT_LABEL[e.toLowerCase()] ?? e).join(',')}`)
    .join('\n')
...
Available exercises (name|muscles|equipment):
${exerciseList}
```

**(d)** Delete the trailing `Return this JSON schema exactly: { ... }` block (~lines 320–339) — the schema is now enforced. Keep rules 1–13 (split recommendations, session names, muscle priority, recovery ordering) untouched.

- [ ] **Step 6.3: Swap the call.** Replace the `generateText` + `JSON.parse` block (~lines 342–368) with:

```ts
    const { object: raw } = await withAiRetry(
      () => generateObject({
        model: google('gemini-3.1-flash-lite'),
        schema: GeneratedProgramSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
      { shouldRetry: isRetryableObjectError },
    )
```

Delete the manual `let raw: {...}` type declaration (the schema infers it). The downstream code (`validNames` filtering, emoji fallback, style enforcement, phase-set resolution) is unchanged, except `ex.progressionStyleName ?? ''` can become `ex.progressionStyleName` and `(ex.exerciseRole ?? 'accessory')` can become `ex.exerciseRole` (both now schema-guaranteed). Imports: swap `generateText` → `generateObject`, add the retry import.

- [ ] **Step 6.4: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep "generate-program" ; pnpm test
git add app/api/generate-program/route.ts
git commit -m "Schema-constrain program generation and cut redundant prompt blocks

The per-goal ALWAYS-use style rules were dead weight — server-side
GOAL_STYLE_RULES overrides the model's choices regardless — and the exercise
library was pretty-printed JSON. Both trimmed; output is now constrained decoding."
```

**Manual verification:** dev server → builder wizard → generate a 3-day hypertrophy program with full gym. Expect sessions named Push/Pull/Legs-style, all exercises from the library, primary exercises carrying `General 4-set`. Repeat once to confirm no parse-failure 500s.

---

### Task 7: `prescribe` → `generateObject` with the existing Zod schema (E1)

**Files:**
- Modify: `app/api/ai-periodization/session/[sessionId]/prescribe/route.ts`
- Modify: `lib/ai-periodization/prompt.ts`

- [ ] **Step 7.1: Swap the call.** In the prescribe route, replace lines ~155–177:

```ts
// BEFORE
  let rawText: string
  try {
    const result = await generateText({
      model: google('gemini-3.1-flash-lite'),
      system: systemPrompt,
      prompt: userPrompt,
    })
    rawText = result.text
  } catch (err) {
    console.error('Gemini prescription generation failed:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }

  // Strip code fences if present
  const stripped = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: z.infer<typeof PrescriptionSchema>
  try {
    parsed = PrescriptionSchema.parse(JSON.parse(stripped))
  } catch (err) {
    console.error('Prescription parse/validate failed:', err, '\nRaw:', rawText)
    return NextResponse.json({ error: 'Invalid AI response' }, { status: 502 })
  }
```

```ts
// AFTER
  let parsed: z.infer<typeof PrescriptionSchema>
  try {
    const result = await withAiRetry(
      () => generateObject({
        model: google('gemini-3.1-flash-lite'),
        schema: PrescriptionSchema,
        system: systemPrompt,
        prompt: userPrompt,
        maxRetries: 0,
      }),
      { shouldRetry: isRetryableObjectError },
    )
    parsed = result.object
  } catch (err) {
    console.error('Gemini prescription generation failed:', err)
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }
```

Imports: `generateText` → `generateObject`; add `import { withAiRetry, isRetryableObjectError } from '@/lib/ai/retry'`. `PrescriptionSchema` (lines 17–31) is used as-is — it already exists and its `z.enum`/bounded numbers become the constrained-decoding grammar, which kills the "model invents a session_exercise_id" → 502 class. Everything downstream (`applyAutoregulation`, `fitToBudget`, phase guards, auto-apply gate) is untouched. **Do NOT touch the emergency-deload block (C1) or the confidence gate (C6) — out of scope.**

- [ ] **Step 7.2: Trim the now-redundant output-format block in `lib/ai-periodization/prompt.ts`.** In `buildSystemPrompt`, replace the tail:

```
// BEFORE (lines ~80-97)
Output format: JSON only, no markdown, no prose. Exact keys:
{
  "phase": "accumulation" | "intensification" | "realisation" | "deload",
  ... (full JSON shape) ...
}
```

```
// AFTER — keep only the field semantics the schema can't express
Output field notes:
- session_exercise_id: copy exactly from the exercise list — never invent one.
- reasoning: 1-2 sentences.
- confidence: your certainty in this prescription, 0.0-1.0.
```

And in `buildUserPrompt`, change the final line `Output only the JSON prescription object. No markdown, no prose, just the JSON.` to `Provide the prescription.` **Leave everything else in prompt.ts alone** (the ACWR gate text fix is Batch C5).

- [ ] **Step 7.3: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep -E "prescribe|ai-periodization" ; pnpm test
git add app/api/ai-periodization/session/\[sessionId\]/prescribe/route.ts lib/ai-periodization/prompt.ts
git commit -m "Use constrained decoding for AI prescriptions

Fence-stripping plus manual Zod parse meant a hallucinated key or stray prose
502'd the whole prescription; generateObject with the existing schema makes
invalid shapes unrepresentable."
```

**Manual verification:** requires an AI-dynamic program on the local DB. On the dev server, open a session with AI periodization enabled and trigger a prescription (session-select → AI prescription card). Expect a full per-exercise prescription; check the log for no `parse/validate failed`. If the seeded local DB has no AI-dynamic program, verify via type-check + the unchanged unit tests (`apply-prescription.test.ts`, `autoregulation.test.ts`) and note it for APK/staging verification.

---

### Task 8: `health-insight` contributor pre-formatting (E4)

**Files:**
- Create: `lib/oura/contributors.ts`
- Create: `lib/__tests__/oura-contributors.test.ts`
- Modify: `app/api/ai/health-insight/route.ts`

- [ ] **Step 8.1: Create `lib/oura/contributors.ts`**:

```ts
// Oura contributor keys → human labels. Keys per the Oura v2 API docs
// (daily_readiness / daily_sleep / daily_activity contributors).
const CONTRIBUTOR_LABELS: Record<string, string> = {
  activity_balance: 'Activity balance',
  body_temperature: 'Body temperature',
  hrv_balance: 'HRV balance',
  previous_day_activity: 'Previous day activity',
  previous_night: 'Previous night',
  recovery_index: 'Recovery index',
  resting_heart_rate: 'Resting heart rate',
  sleep_balance: 'Sleep balance',
  deep_sleep: 'Deep sleep',
  efficiency: 'Efficiency',
  latency: 'Latency',
  rem_sleep: 'REM sleep',
  restfulness: 'Restfulness',
  timing: 'Timing',
  total_sleep: 'Total sleep',
  meet_daily_targets: 'Meet daily targets',
  move_every_hour: 'Move every hour',
  recovery_time: 'Recovery time',
  stay_active: 'Stay active',
  training_frequency: 'Training frequency',
  training_volume: 'Training volume',
}

function labelFor(key: string): string {
  return CONTRIBUTOR_LABELS[key] ?? key.replace(/_/g, ' ')
}

// "HRV balance 82/100, Resting heart rate 90/100, …" — sorted worst-first so the
// model sees the weak spots without parsing nested JSON.
export function formatContributors(contributors: Record<string, number | null> | null | undefined): string {
  if (!contributors) return 'no contributor data'
  const entries = Object.entries(contributors)
    .filter((e): e is [string, number] => e[1] != null)
    .sort((a, b) => a[1] - b[1])
  if (entries.length === 0) return 'no contributor data'
  return entries.map(([k, v]) => `${labelFor(k)} ${v}/100`).join(', ')
}
```

- [ ] **Step 8.2: Create `lib/__tests__/oura-contributors.test.ts`**:

```ts
import { describe, it, expect } from 'vitest'
import { formatContributors } from '@/lib/oura/contributors'

describe('formatContributors', () => {
  it('labels known keys and sorts worst-first', () => {
    expect(formatContributors({ hrv_balance: 90, deep_sleep: 60 }))
      .toBe('Deep sleep 60/100, HRV balance 90/100')
  })
  it('skips nulls and falls back to humanised unknown keys', () => {
    expect(formatContributors({ some_new_key: 70, timing: null }))
      .toBe('some new key 70/100')
  })
  it('handles null/empty input', () => {
    expect(formatContributors(null)).toBe('no contributor data')
    expect(formatContributors({})).toBe('no contributor data')
  })
})
```

- [ ] **Step 8.3: Rewrite the data assembly in `app/api/ai/health-insight/route.ts`.** Replace `buildPrompt` and the `sectionData: Record<string, unknown>` blocks with labeled lines (everything else — auth, cache check, rate limit, repo fetches, `bandLabel`, cache upsert — stays identical):

```ts
import { formatContributors } from '@/lib/oura/contributors'

function buildPrompt(section: string, dataLines: string[]): string {
  return `You are a concise health coach. Write a single insight (2-3 sentences, no markdown) for the user's ${section} data. Be specific to the numbers. End with one actionable tip.

Data:
${dataLines.join('\n')}`
}
```

```ts
  let dataLines: string[]
  if (section === 'readiness') {
    dataLines = [
      `Readiness score: ${todayOura?.readinessScore ?? 'unknown'}/100 (${bandLabel(todayOura?.readinessScore ?? null)})`,
      `Contributors: ${formatContributors(todayOura?.readinessContributors)}`,
      todayOura?.temperatureDeviation != null
        ? `Body temp deviation: ${todayOura.temperatureDeviation > 0 ? '+' : ''}${todayOura.temperatureDeviation.toFixed(1)}°C`
        : 'Body temp deviation: no data',
      `Past week scores: ${ouraRows.map(r => `${r.date} ${r.readinessScore ?? '—'}`).join(', ')}`,
    ]
  } else if (section === 'sleep') {
    const todaySleep = sleepRows.find(r => r.date === date) ?? sleepRows[sleepRows.length - 1] ?? null
    dataLines = [
      `Sleep score: ${todayOura?.sleepScore ?? 'unknown'}/100`,
      todaySleep?.durationHours != null ? `Duration: ${Math.round(todaySleep.durationHours * 60)} min` : 'Duration: no data',
      todaySleep?.efficiency != null ? `Efficiency: ${todaySleep.efficiency}%` : 'Efficiency: no data',
      todaySleep?.averageHrvMs != null ? `Overnight HRV: ${Math.round(todaySleep.averageHrvMs)} ms` : 'Overnight HRV: no data',
      todaySleep?.avgHeartRate != null ? `Avg sleeping HR: ${Math.round(todaySleep.avgHeartRate)} bpm` : 'Avg sleeping HR: no data',
      `Contributors: ${formatContributors(todayOura?.sleepContributors)}`,
    ]
  } else if (section === 'heart-rate') {
    const todayBm = bodyMetrics.find(r => r.date === date) ?? bodyMetrics[bodyMetrics.length - 1] ?? null
    dataLines = [
      todayBm?.restingHeartRate != null ? `Resting heart rate: ${todayBm.restingHeartRate} bpm` : 'Resting heart rate: no data',
      todayBm?.hrvMs != null ? `HRV: ${todayBm.hrvMs} ms` : 'HRV: no data',
      `7-day RHR readings: ${bodyMetrics.filter(r => r.restingHeartRate).map(r => `${r.restingHeartRate}`).join(', ') || 'none'}`,
    ]
  } else {
    dataLines = [
      `Activity score: ${todayOura?.activityScore ?? 'unknown'}/100 (${bandLabel(todayOura?.activityScore ?? null)})`,
      todayOura?.activeCalories != null ? `Active calories: ${todayOura.activeCalories} kcal` : 'Active calories: no data',
      `Contributors: ${formatContributors(todayOura?.activityContributors)}`,
    ]
  }

  const { text } = await generateText({
    model: google('gemini-3.1-flash-lite'),
    prompt: buildPrompt(section, dataLines),
  })
```

- [ ] **Step 8.4: Verify + commit**

```bash
pnpm test lib/__tests__/oura-contributors.test.ts && pnpm lint && npx tsc --noEmit 2>&1 | grep "health-insight"
git add lib/oura/contributors.ts lib/__tests__/oura-contributors.test.ts app/api/ai/health-insight/route.ts
git commit -m "Feed health insights labeled lines instead of raw JSON

JSON.stringify of nested contributor objects wasted tokens and made the model
paraphrase snake_case keys; contributors are now pre-formatted worst-first."
```

**Manual verification:** dev server → Health tab → tap a readiness/sleep card's insight (use `force: true` via the refresh affordance or `curl` after grabbing the session cookie from devtools: `curl -s -X POST http://localhost:3000/api/ai/health-insight -H 'Content-Type: application/json' -H "Cookie: <copied>" -d '{"section":"readiness","force":true}'`). Expect a 2–3 sentence insight referencing contributor names in plain English (e.g. "HRV balance"), never `hrv_balance`.

---

### Task 9: Cache + harden `session-explain/insight` (E2 + E5)

**Files:**
- Modify: `app/api/session-explain/insight/route.ts`
- Modify: `app/session-explain/components/ai-insight-card.tsx`

Cache key: `(userId, programSessionId, date)` mapped onto the existing `ai_health_insights` table as `section = 'session-explain:' + programSessionId`, `date = todayInTz(tz)` — no migration needed (`section` is TEXT with a `UNIQUE (user_id, section, date)` constraint; repo methods `getAiHealthInsight`/`upsertAiHealthInsight` already exist).

- [ ] **Step 9.1: Rewrite the route**:

```ts
import { google } from '@ai-sdk/google'
import { streamText } from 'ai'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { errorLog } from '@/lib/logger'
import { NextResponse } from 'next/server'
import { DEFAULT_TZ, todayInTz } from '@/lib/date-utils'
import { textStreamResponse } from '@/lib/ai/stream'

export async function GET() {
  try {
    const session = await auth()
    const userId = session?.user?.id
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const tz = session.user?.timezone ?? DEFAULT_TZ
    const repo = await getRepository()
    const recommendation = await repo.getNextSession(userId, tz)

    if (!recommendation.session || !recommendation.signals || !recommendation.weightedComponents) {
      return NextResponse.json({ error: 'No AI dynamic recommendation available' }, { status: 404 })
    }

    const today = todayInTz(tz)
    const cacheSection = `session-explain:${recommendation.session.id}`
    const cached = await repo.getAiHealthInsight(userId, cacheSection, today)
    if (cached) {
      return new Response(cached, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
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

(The prompt is byte-identical to today's — only the cache wrapper and stream wrapper are new. **No rate limit is added — that's excluded quick-win 6.**)

- [ ] **Step 9.2: Client marker detection in `ai-insight-card.tsx`.** Replace the fetch loop body:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { SparklesIcon } from 'lucide-react'
import { splitStreamError } from '@/lib/ai/stream'

export function AiInsightCard({ sessionId }: { sessionId: string }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [errored, setErrored] = useState(false)

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
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchInsight()
    return () => { cancelled = true }
  }, [sessionId])
```

And in the render, below the text paragraph add:

```tsx
      {errored && (
        <p className="text-xs text-destructive">The insight was cut short — check your connection and reopen this page to retry.</p>
      )}
```

(Keep the rest of the component — icon header, skeleton — unchanged.)

- [ ] **Step 9.3: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep "session-explain" ; pnpm test
git add app/api/session-explain/insight/route.ts app/session-explain/components/ai-insight-card.tsx
git commit -m "Cache session-explain insights per session+day and survive mid-stream failures

Every visit to the explain page burned a Gemini call for a near-deterministic
answer; now the first call of the day per recommended session is the only one.
A mid-stream provider error now surfaces instead of truncating silently."
```

**Manual verification:** dev server → home → "Why this?" on the recommendation card (needs an ai_dynamic program; otherwise expect the 404 path). First load streams; reload the page — the insight should render instantly (single flush, no streaming delay) and the server log shows no second Gemini call. Confirm the row: `psql postgresql://postgres:postgres@localhost:5433/trainingai_dev -c "select section, date, left(insight, 60) from ai_health_insights where section like 'session-explain:%';"`. **Mid-stream failure simulation:** temporarily throw inside a wrapper around `result.textStream` (e.g. an async generator that yields the first chunk then throws), confirm the card shows the partial text + "cut short" note; revert.

---

### Task 10: Weekly digest — enrich, cache by ISO week, wire the orphaned route to its consumer (E2)

**Consumer resolution (investigated):** `app/api/weekly-digest/route.ts` is orphaned — the only "weekly summary" UI, `components/weekly-ai-summary.tsx` (used by stats/health/overview screens), calls `/api/ai-chat` with a 300-word prompt instead. Per plan scope we take the **wiring option**: enrich the digest route (HRV, readiness, PRs, per-muscle volume — all from existing repo methods), cache it by `(userId, isoWeek)`, and point `WeeklySummaryCard` at it.

**Files:**
- Modify: `app/api/weekly-digest/route.ts`
- Modify: `components/weekly-ai-summary.tsx`

- [ ] **Step 10.1: Rewrite `app/api/weekly-digest/route.ts`**:

```ts
import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { getRepository } from '@/lib/data'
import { google } from '@ai-sdk/google'
import { generateText } from 'ai'
import { toZonedTime, fromZonedTime, formatInTimeZone } from 'date-fns-tz'
import { DEFAULT_TZ } from '@/lib/date-utils'
import { rateLimit } from '@/lib/rate-limit'
import { withAiRetry } from '@/lib/ai/retry'

const CACHE_SECTION = 'weekly-digest'

export async function POST(req: Request) {
  const session = await auth()
  const userId = session?.user?.id
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let force = false
  try { force = Boolean((await req.json())?.force) } catch { /* no body */ }

  const tz = session.user?.timezone ?? DEFAULT_TZ
  const nowUtc = new Date()

  // Monday of the current ISO week in user's timezone — also the cache key
  const nowZoned = toZonedTime(nowUtc, tz)
  const daysFromMonday = (nowZoned.getDay() + 6) % 7
  const mondayZoned = new Date(nowZoned)
  mondayZoned.setDate(mondayZoned.getDate() - daysFromMonday)
  mondayZoned.setHours(0, 0, 0, 0)
  const thisWeekStart = fromZonedTime(mondayZoned, tz)
  const isoWeekKey = formatInTimeZone(thisWeekStart, tz, 'yyyy-MM-dd')

  const repo = await getRepository()

  // Cache first — cached reads don't cost an AI call so don't count against the limit
  if (!force) {
    const cached = await repo.getAiHealthInsight(userId, CACHE_SECTION, isoWeekKey)
    if (cached) return NextResponse.json({ digest: cached, generatedAt: null, cached: true })
  }

  if (!rateLimit(`${userId}:weekly-digest`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * 86400_000)
  const todayIso   = formatInTimeZone(nowUtc, tz, 'yyyy-MM-dd')
  const from14dIso = formatInTimeZone(lastWeekStart, tz, 'yyyy-MM-dd')

  const [sessions, bodyMetrics, sleepSessions, ouraRows, weekPrs] = await Promise.all([
    repo.getWorkoutSessionsFrom(userId, lastWeekStart),
    repo.listBodyMetrics(userId, from14dIso, todayIso),
    repo.listSleepSessions(userId, from14dIso, todayIso),
    repo.getOuraDaily(userId, from14dIso, todayIso),
    repo.listRecentPersonalRecords(userId, thisWeekStart, nowUtc),
  ])

  const thisWeekSessions = sessions.filter(ws => ws.startedAt >= thisWeekStart && ws.exercises.length > 0)
  const lastWeekSessions = sessions.filter(ws => ws.startedAt <  thisWeekStart && ws.exercises.length > 0)

  const sumVol = (arr: typeof sessions) =>
    arr.reduce((s, ws) => s + ws.exercises.reduce((e, ex) => e + (ex.volume ?? 0), 0), 0)

  const thisWeekVol = Math.round(sumVol(thisWeekSessions))
  const lastWeekVol = Math.round(sumVol(lastWeekSessions))
  const volChange   = lastWeekVol > 0
    ? `${thisWeekVol > lastWeekVol ? '+' : ''}${Math.round((thisWeekVol - lastWeekVol) / lastWeekVol * 100)}% vs last week`
    : 'first week of data'

  // Per-muscle weighted set volume this week (main = 1.0, secondary = 0.5 —
  // same weighting as the periodization engine)
  const exerciseNames = [...new Set(thisWeekSessions.flatMap(ws => ws.exercises.map(ex => ex.exerciseName)))]
  const muscleAssignments = exerciseNames.length > 0
    ? await repo.getExerciseMuscleAssignments(exerciseNames)
    : {}
  const muscleSets: Record<string, number> = {}
  for (const ws of thisWeekSessions) {
    for (const ex of ws.exercises) {
      for (const ma of muscleAssignments[ex.exerciseName] ?? []) {
        const weight = ma.role === 'main' ? 1.0 : 0.5
        const muscle = ma.muscle.toLowerCase()
        muscleSets[muscle] = (muscleSets[muscle] ?? 0) + ex.sets.length * weight
      }
    }
  }
  const muscleVolumeLine = Object.keys(muscleSets).length > 0
    ? `Weekly sets per muscle (weighted): ${Object.entries(muscleSets)
        .sort((a, b) => b[1] - a[1])
        .map(([m, s]) => `${m} ${s.toFixed(1)}`)
        .join(', ')}`
    : null

  const recentWeights = bodyMetrics.filter(m => m.weightKg != null).sort((a, b) => b.date.localeCompare(a.date))
  const weightChange  = recentWeights.length >= 2
    ? `${(recentWeights[0].weightKg! - recentWeights[recentWeights.length - 1].weightKg!).toFixed(1)} kg over 2 weeks`
    : null

  const avgSleep = sleepSessions.filter(s => s.durationHours != null).length
    ? (sleepSessions.reduce((s, r) => s + (r.durationHours ?? 0), 0) / sleepSessions.filter(s => s.durationHours != null).length).toFixed(1) + 'h avg sleep'
    : null

  // HRV: overnight average this week vs last (sleep_sessions.averageHrvMs, falling back to body_metrics.hrvMs)
  const hrvOf = (from: string, to: string) => {
    const sleepVals = sleepSessions.filter(s => s.date >= from && s.date <= to && s.averageHrvMs != null).map(s => s.averageHrvMs!)
    const bmVals = bodyMetrics.filter(m => m.date >= from && m.date <= to && m.hrvMs != null).map(m => m.hrvMs!)
    const vals = sleepVals.length > 0 ? sleepVals : bmVals
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const lastWeekEndIso = formatInTimeZone(new Date(thisWeekStart.getTime() - 86400_000), tz, 'yyyy-MM-dd')
  const hrvThisWeek = hrvOf(isoWeekKey, todayIso)
  const hrvLastWeek = hrvOf(from14dIso, lastWeekEndIso)
  const hrvLine = hrvThisWeek != null
    ? `HRV: ${hrvThisWeek} ms avg this week${hrvLastWeek != null ? ` (last week ${hrvLastWeek} ms)` : ''}`
    : null

  // Oura readiness: this-week average vs last-week average
  const readinessOf = (from: string, to: string) => {
    const vals = ouraRows.filter(r => r.date >= from && r.date <= to && r.readinessScore != null).map(r => r.readinessScore!)
    return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  const readyThis = readinessOf(isoWeekKey, todayIso)
  const readyLast = readinessOf(from14dIso, lastWeekEndIso)
  const readinessLine = readyThis != null
    ? `Oura readiness: ${readyThis}/100 avg this week${readyLast != null ? ` (last week ${readyLast}/100)` : ''}`
    : null

  const prLine = weekPrs.length > 0
    ? `PRs this week: ${weekPrs.map(pr => `${pr.exerciseName} ${Math.round(pr.estimated1rm)}kg est. 1RM`).join(', ')}`
    : 'PRs this week: none'

  let friendsContext: string | null = null
  try {
    const friendIds = await repo.getFriendIds(userId)
    if (friendIds.length > 0) friendsContext = `Friends training this week: ${friendIds.length} friends connected`
  } catch { /* non-fatal */ }

  const context = [
    `This week: ${thisWeekSessions.length} sessions, ${thisWeekVol} kg volume (${volChange})`,
    `Last week: ${lastWeekSessions.length} sessions, ${lastWeekVol} kg volume`,
    muscleVolumeLine,
    prLine,
    hrvLine,
    readinessLine,
    weightChange ? `Body weight change: ${weightChange}` : null,
    avgSleep,
    friendsContext,
  ].filter(Boolean).join('\n')

  const { text } = await withAiRetry(() => generateText({
    model: google('gemini-3.1-flash-lite'),
    prompt: `You are a personal training coach. Write a concise weekly training digest (4–6 bullet points, max 180 words total). Cover training load, any PRs, recovery (HRV/readiness/sleep), and one specific recommendation for the rest of the week. Be specific, encouraging, and actionable. Use the data below — quote its numbers, never invent or recompute any.\n\n${context}`,
    maxRetries: 0,
  }))

  const digest = text.trim()
  await repo.upsertAiHealthInsight(userId, CACHE_SECTION, isoWeekKey, digest)

  return NextResponse.json({ digest, generatedAt: new Date().toISOString(), cached: false })
}
```

- [ ] **Step 10.2: Wire `components/weekly-ai-summary.tsx` to the digest.** Changes:
  - Delete `WEEKLY_PROMPT`, the `parseChartBlocks`/`ChartMessage` imports and usage, and the `document.cookie = 'ta_session=Overview…'` line (the digest doesn't take a prompt and produces no charts).
  - Delete the `todayInTz` import usage in the request body (no longer sent); keep `startOfWeekInTz` for the localStorage key.
  - Replace `fetchSummary` with:

```tsx
  async function fetchSummary(force = false) {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setIsLoading(true);
    setError(null);
    setContent(null);

    try {
      const res = await fetch("/api/weekly-digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortRef.current.signal,
        body: JSON.stringify({ force }),
      });
      if (!res.ok) throw new Error("Request failed");
      const data: { digest: string } = await res.json();

      const now = Date.now();
      setContent(data.digest);
      setFetchedAt(now);
      localStorage.setItem(cacheKey, JSON.stringify({ content: data.digest, weekStart, fetchedAt: now }));
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError("Could not load summary.");
    } finally {
      setIsLoading(false);
    }
  }
```

  - `handleRefresh` calls `fetchSummary(true)` (server-side force regenerate) and still clears the localStorage key.
  - Delete the `streaming` state and every usage of it (the skeleton condition becomes `isLoading` alone; `displayContent` becomes just `content`; the render block drops `charts`):

```tsx
          {content && <Response className="text-sm leading-relaxed">{content}</Response>}
```

  - Bump `CACHE_KEY_PREFIX` to `"ta_weekly_summary_v3_"` so stale ai-chat-format entries don't render.

- [ ] **Step 10.3: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep -E "weekly-digest|weekly-ai-summary" ; pnpm test
git add app/api/weekly-digest/route.ts components/weekly-ai-summary.tsx
git commit -m "Wire the weekly summary card to the enriched, cached digest route

The digest route existed but nothing called it — the card burned a full ai-chat
context (90 days of history) every week-start instead. The digest now carries
HRV, readiness, PRs and per-muscle volume, and is cached per ISO week."
```

**Manual verification:** dev server → Stats tab → expand Weekly Summary. First load generates (spinner then 4–6 bullets quoting real numbers — seeded workouts should yield per-muscle set counts). Tap refresh — regenerates (force). Collapse/reopen and hard-reload — instant, and `psql ... -c "select section, date from ai_health_insights where section='weekly-digest';"` shows one row for this week's Monday. Also check Health tab and Overview screen render the same card without errors.

---

### Task 11: AI-chat stage 1 — recovery/wellness context + precomputed 1RM injection (E3 stage 1 + E4)

**Files:**
- Create: `lib/ai-chat/context.ts` (context builders moved out of the route — route files must only export handlers, and the new builders need unit tests)
- Create: `lib/__tests__/ai-chat-context.test.ts`
- Modify: `app/api/ai-chat/route.ts`

- [ ] **Step 11.1: Create `lib/ai-chat/context.ts`.** Move these functions verbatim from `app/api/ai-chat/route.ts` (with their `fmt` helper and the three `MAX_*` constants they use): `buildProgramSummary`, `buildWorkoutHistory`, `buildBodyMetricsSummary`, `buildNutritionSummary`, `buildWeekSchedule`, `capTrainingData` — all as named exports. Then add the two new builders:

```ts
import { mround } from '@/lib/1rm'
import type { WorkoutSession, SleepSession } from '@/lib/types'
import type { OuraDailyRow } from '@/lib/data/repository'
import type { DayCheckin } from '@/lib/types/day-checkin'

// Precomputed per-exercise est-1RM + target working weight. The model quotes
// these; it must never run Epley/Brzycki itself (it gets them wrong).
export function build1RmTargets(sessions: WorkoutSession[]): string {
  const latest = new Map<string, { orm: number; date: Date }>()
  for (const ws of sessions) {
    for (const el of ws.exercises) {
      if (el.estimated1rm == null || el.estimated1rm <= 0) continue
      const cur = latest.get(el.exerciseName)
      if (!cur || ws.startedAt > cur.date) latest.set(el.exerciseName, { orm: el.estimated1rm, date: ws.startedAt })
    }
  }
  if (latest.size === 0) return '## Estimated 1RMs\n(no 1RM estimates yet)'
  const lines = ['## Estimated 1RMs & target working weights (precomputed — quote, never recompute)']
  for (const [name, { orm }] of [...latest.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`${name}: est 1RM ${mround(orm, 0.25)}kg → target working weight ${mround(orm * 0.8, 1.25)}kg`)
  }
  return lines.join('\n')
}

function checkinLine(label: string, c: DayCheckin | null): string | null {
  if (!c) return null
  const parts: string[] = []
  if (c.physicalTiredness != null) parts.push(`physical tiredness ${c.physicalTiredness}/5`)
  if (c.mentalDrain != null) parts.push(`mental drain ${c.mentalDrain}/5`)
  if (c.barelyMoved != null) parts.push(`movement ${c.barelyMoved}/5 (5 = sat all day)`)
  if (c.hydration != null) parts.push(`hydration ${c.hydration}/5 (5 = barely drank)`)
  if (c.lateHeavyMeal != null) parts.push(`late/heavy meal ${c.lateHeavyMeal}/5`)
  if (c.soreMuscles.length > 0) parts.push(`sore: ${c.soreMuscles.join(', ')}`)
  return parts.length > 0 ? `${label}: ${parts.join(', ')}` : null
}

// Mirrors morning-briefing's Oura context format (labels + units).
export function buildRecoverySummary(
  ouraRows: OuraDailyRow[],
  sleepSessions: SleepSession[],
  morningCheckin: DayCheckin | null,
  eveningCheckin: DayCheckin | null,
  todayIso: string,
): string {
  const lines: string[] = ['## Recovery & Wellness']

  const ouraToday = ouraRows.find(r => r.date === todayIso) ?? null
  const ouraParts = ouraToday ? [
    ouraToday.readinessScore != null ? `Oura readiness ${ouraToday.readinessScore}/100` : null,
    ouraToday.sleepScore != null ? `sleep score ${ouraToday.sleepScore}/100` : null,
    ouraToday.activityScore != null ? `activity score ${ouraToday.activityScore}/100` : null,
    ouraToday.resilienceLevel != null ? `resilience: ${ouraToday.resilienceLevel}` : null,
    ouraToday.temperatureDeviation != null && Math.abs(ouraToday.temperatureDeviation) > 0.3
      ? `body temp deviation ${ouraToday.temperatureDeviation > 0 ? '+' : ''}${ouraToday.temperatureDeviation.toFixed(1)}°C`
      : null,
  ].filter(Boolean) : []
  lines.push(ouraParts.length > 0 ? `Today: ${ouraParts.join(', ')}` : 'Today: no Oura data')

  const sorted = [...sleepSessions].sort((a, b) => b.date.localeCompare(a.date))
  const lastSleep = sorted[0] ?? null
  if (lastSleep) {
    const sleepParts = [
      lastSleep.durationHours != null ? `${lastSleep.durationHours.toFixed(1)}h sleep` : null,
      lastSleep.efficiency != null ? `efficiency ${lastSleep.efficiency}%` : null,
      lastSleep.averageHrvMs != null ? `overnight HRV ${Math.round(lastSleep.averageHrvMs)} ms` : null,
      lastSleep.lowestHeartRate != null ? `lowest HR ${lastSleep.lowestHeartRate} bpm` : null,
    ].filter(Boolean)
    if (sleepParts.length > 0) lines.push(`Last night: ${sleepParts.join(', ')}`)
  }

  const week = ouraRows.filter(r => r.readinessScore != null)
  if (week.length >= 3) {
    const avg = Math.round(week.reduce((s, r) => s + r.readinessScore!, 0) / week.length)
    lines.push(`7-day readiness avg: ${avg}/100`)
  }
  const hrvWeek = sleepSessions.filter(s => s.averageHrvMs != null)
  if (hrvWeek.length >= 3) {
    const avg = Math.round(hrvWeek.reduce((s, r) => s + r.averageHrvMs!, 0) / hrvWeek.length)
    lines.push(`7-day overnight HRV avg: ${avg} ms`)
  }

  const morning = checkinLine('Morning check-in (today)', morningCheckin)
  const evening = checkinLine('Evening check-in (yesterday)', eveningCheckin)
  if (morning) lines.push(morning)
  if (evening) lines.push(evening)
  if (!morning && !evening) lines.push('No check-ins logged.')

  return lines.join('\n')
}
```

(Check the exact `SleepSession` field names in `lib/types` while moving — `durationHours`, `efficiency`, `averageHrvMs`, `lowestHeartRate`, `date` are the ones used by morning-briefing/health-insight today.)

- [ ] **Step 11.2: Create `lib/__tests__/ai-chat-context.test.ts`** for the two new pure builders:

```ts
import { describe, it, expect } from 'vitest'
import { build1RmTargets, buildRecoverySummary } from '@/lib/ai-chat/context'
import type { WorkoutSession } from '@/lib/types'

function ws(startedAt: string, exercises: { name: string; orm: number | null }[]): WorkoutSession {
  return {
    id: 'x', sessionName: 'Push', startedAt: new Date(startedAt),
    exercises: exercises.map(e => ({
      exerciseName: e.name, estimated1rm: e.orm, sets: [], volume: null, loggedAt: new Date(startedAt),
    })),
  } as unknown as WorkoutSession
}

describe('build1RmTargets', () => {
  it('uses the most recent est 1RM per exercise and rounds targets to 1.25kg', () => {
    const out = build1RmTargets([
      ws('2026-06-01T10:00:00Z', [{ name: 'Bench Press', orm: 78 }]),
      ws('2026-06-20T10:00:00Z', [{ name: 'Bench Press', orm: 80 }]),
    ])
    expect(out).toContain('Bench Press: est 1RM 80kg → target working weight 64kg')
    expect(out).toContain('quote, never recompute')
  })
  it('skips null/zero estimates and handles empty history', () => {
    expect(build1RmTargets([ws('2026-06-01T10:00:00Z', [{ name: 'Plank', orm: null }])]))
      .toContain('(no 1RM estimates yet)')
  })
})

describe('buildRecoverySummary', () => {
  it('renders today Oura scores and last-night sleep', () => {
    const out = buildRecoverySummary(
      [{ date: '2026-07-01', readinessScore: 78, sleepScore: 82, activityScore: null, temperatureDeviation: 0.5, resilienceLevel: 'solid' }],
      [{ date: '2026-07-01', durationHours: 7.4, efficiency: 91, averageHrvMs: 68, lowestHeartRate: 47 } as never],
      null, null, '2026-07-01',
    )
    expect(out).toContain('Oura readiness 78/100')
    expect(out).toContain('body temp deviation +0.5°C')
    expect(out).toContain('7.4h sleep')
    expect(out).toContain('No check-ins logged.')
  })
  it('degrades to explicit no-data lines', () => {
    const out = buildRecoverySummary([], [], null, null, '2026-07-01')
    expect(out).toContain('Today: no Oura data')
  })
})
```

(Adjust the `as never`/`as unknown as` casts to the real type shapes if the type checker complains — the point of the test is the string output, not the fixtures.)

- [ ] **Step 11.3: Update `app/api/ai-chat/route.ts`.**
  - Replace the local builder definitions with imports from `@/lib/ai-chat/context`.
  - Extend the fetch block:

```ts
    const from7dIsoStr = formatInTimeZone(new Date(todayMidnight.getTime() - 7 * 86_400_000), tz, 'yyyy-MM-dd');
    const yesterdayIso = formatInTimeZone(new Date(todayMidnight.getTime() - 86_400_000), tz, 'yyyy-MM-dd');

    const [program, recentSessions, bodyMetrics, todayLogs, nutritionTargets, ouraRows, sleepSessions, morningCheckin, eveningCheckin] = await Promise.all([
      repo.getActiveProgram(userId),
      repo.getWorkoutSessionsFrom(userId, from90d),
      repo.listBodyMetrics(userId, from14dIsoStr, todayIso),
      repo.listFoodLogs(userId, todayIso),
      repo.getNutritionTargets(userId),
      repo.getOuraDaily(userId, from7dIsoStr, todayIso),
      repo.listSleepSessions(userId, from7dIsoStr, todayIso),
      repo.getDayCheckin(userId, todayIso, 'morning'),
      repo.getDayCheckin(userId, yesterdayIso, 'evening'),
    ]);
```

  - Build the two new blocks and add them to the training data:

```ts
    const recoverySummary = buildRecoverySummary(ouraRows, sleepSessions, morningCheckin, eveningCheckin, todayIso);
    const oneRmTargets    = build1RmTargets(filteredSessions);
    ...
    const trainingData = capTrainingData([programSummary, weekSchedule, recoverySummary, oneRmTargets, workoutHistory, bodyMetricsSummary, nutritionSummary].join("\n\n"));
```

(Recovery + 1RM blocks go **before** workoutHistory so the char cap truncates old history, not the new context.)

  - Replace the Epley block in the system prompt:

```
// BEFORE
## 1RM & weight recommendations
For each exercise, use the most recent data:
1. Epley 1RM = weight × (1 + reps / 30)
2. Target working weight = 1RM × 0.80, rounded to nearest 1.25kg
Output: "Last session: 60kg × avg 8 reps → est 1RM ~80kg → working weight today: **64kg**"
```

```
// AFTER
## 1RM & weight recommendations
Estimated 1RMs and target working weights are precomputed by the app and listed in the data below.
Quote them exactly — NEVER recompute a 1RM or working weight with any formula (no Epley, no Brzycki, no percentages).
If an exercise has no precomputed value, say there isn't enough logged data yet.
```

- [ ] **Step 11.4: Verify + commit**

```bash
pnpm test lib/__tests__/ai-chat-context.test.ts && pnpm lint && npx tsc --noEmit 2>&1 | grep -E "ai-chat"
git add lib/ai-chat/context.ts lib/__tests__/ai-chat-context.test.ts app/api/ai-chat/route.ts
git commit -m "Give AI chat recovery context and precomputed 1RM targets

The chat couldn't answer 'should I train given my recovery?' — it saw no Oura,
sleep or check-in data — and it was doing Epley arithmetic itself, often wrongly.
Recovery mirrors the morning-briefing format; 1RMs are now quote-only."
```

**Manual verification:** dev server → open the AI chat → ask `Should I train today given my recovery?`. Expect the answer to reference readiness/sleep/HRV numbers from the seeded data (or say no Oura data if the seed lacks it — check `psql ... -c "select count(*) from oura_daily"`). Ask `What weight should I bench today?` — expect it to quote the injected est-1RM/target values, not derive new ones (numbers must be multiples of 1.25 matching the context block).

---

### Task 12: AI-chat stage 2 — tool-calling loop, remove the static dump (E3 stage 2)

**Files:**
- Create: `lib/ai-chat/tools.ts`
- Modify: `app/api/ai-chat/route.ts`

- [ ] **Step 12.1: Create `lib/ai-chat/tools.ts`** — six read-only tools, each a thin wrapper over existing `WorkoutRepository` methods. All use `inputSchema` (ai SDK v5+/v6 name) and return plain JSON-serialisable objects:

```ts
import { tool } from 'ai'
import { z } from 'zod'
import { formatInTimeZone } from 'date-fns-tz'
import type { WorkoutRepository } from '@/lib/data/repository'

export function buildChatTools(repo: WorkoutRepository, userId: string, tz: string, todayIso: string) {
  return {
    getWorkoutsByExercise: tool({
      description: 'Set-by-set history for one exercise: date, session, weights (kg), reps, estimated 1RM and volume per occurrence. Use for progression questions, charts, and PR checks on a specific lift.',
      inputSchema: z.object({
        exerciseName: z.string().describe('Exact or close exercise name, e.g. "Barbell Bench Press"'),
        days: z.number().int().min(7).max(365).nullable().describe('Lookback window in days; null = 90'),
      }),
      execute: async ({ exerciseName, days }) => {
        const from = new Date(Date.now() - (days ?? 90) * 86_400_000)
        const sessions = await repo.getWorkoutSessionsFrom(userId, from)
        const needle = exerciseName.toLowerCase()
        const entries: object[] = []
        for (const ws of sessions) {
          for (const el of ws.exercises) {
            if (!el.exerciseName.toLowerCase().includes(needle)) continue
            entries.push({
              date: formatInTimeZone(ws.startedAt, tz, 'yyyy-MM-dd'),
              session: ws.sessionName,
              exercise: el.exerciseName,
              weightsKg: el.sets.map(s => s.weightKg),
              reps: el.sets.map(s => s.reps),
              estimated1rmKg: el.estimated1rm ?? null,
              volumeKg: el.volume ?? null,
            })
          }
        }
        return { exerciseName, matches: entries.slice(-30) }
      },
    }),

    getRecoveryData: tool({
      description: 'Oura daily scores (readiness/sleep/activity, temp deviation, resilience), sleep sessions (duration, efficiency, overnight HRV, lowest HR) and body metrics (HRV, resting HR, steps, weight) for a date range. Use for recovery, sleep, HRV and readiness questions.',
      inputSchema: z.object({
        fromDate: z.string().describe('YYYY-MM-DD inclusive'),
        toDate: z.string().describe('YYYY-MM-DD inclusive'),
      }),
      execute: async ({ fromDate, toDate }) => {
        const [oura, sleep, metrics] = await Promise.all([
          repo.getOuraDaily(userId, fromDate, toDate),
          repo.listSleepSessions(userId, fromDate, toDate),
          repo.listBodyMetrics(userId, fromDate, toDate),
        ])
        return {
          ouraDaily: oura.map(r => ({
            date: r.date, readiness: r.readinessScore ?? null, sleepScore: r.sleepScore ?? null,
            activityScore: r.activityScore ?? null, tempDeviationC: r.temperatureDeviation ?? null,
            resilience: r.resilienceLevel ?? null,
          })),
          sleepSessions: sleep.map(s => ({
            date: s.date, durationHours: s.durationHours ?? null, efficiencyPct: s.efficiency ?? null,
            overnightHrvMs: s.averageHrvMs ?? null, lowestHrBpm: s.lowestHeartRate ?? null,
          })),
          bodyMetrics: metrics.map(m => ({
            date: m.date, hrvMs: m.hrvMs ?? null, restingHrBpm: m.restingHeartRate ?? null,
            steps: m.steps ?? null, weightKg: m.weightKg ?? null,
          })),
        }
      },
    }),

    getPersonalRecords: tool({
      description: 'All-time estimated-1RM personal record per exercise (kg). Use to answer "what is my PR" and to flag new PRs.',
      inputSchema: z.object({}),
      execute: async () => ({ recordsKg: Object.fromEntries(await repo.listPersonalRecords(userId)) }),
    }),

    getNutritionDay: tool({
      description: 'Food logs and daily macro targets for one date: per-item calories/protein/carbs/fat plus totals and remaining calories.',
      inputSchema: z.object({
        date: z.string().nullable().describe('YYYY-MM-DD; null = today'),
      }),
      execute: async ({ date }) => {
        const d = date ?? todayIso
        const [logs, targets] = await Promise.all([
          repo.listFoodLogs(userId, d),
          repo.getNutritionTargets(userId),
        ])
        const totals = logs.reduce(
          (acc, l) => ({ calories: acc.calories + l.calories, proteinG: acc.proteinG + l.proteinG, carbsG: acc.carbsG + l.carbsG, fatG: acc.fatG + l.fatG }),
          { calories: 0, proteinG: 0, carbsG: 0, fatG: 0 },
        )
        return {
          date: d,
          targets: targets ? { calories: targets.calories ?? null, proteinG: targets.proteinG ?? null, carbsG: targets.carbsG ?? null, fatG: targets.fatG ?? null } : null,
          totals: { calories: Math.round(totals.calories), proteinG: Math.round(totals.proteinG), carbsG: Math.round(totals.carbsG), fatG: Math.round(totals.fatG) },
          items: logs.map(l => ({ name: l.foodItem.name, meal: l.mealTypeId, calories: Math.round(l.calories), proteinG: Math.round(l.proteinG) })),
        }
      },
    }),

    getDayCheckins: tool({
      description: 'The subjective morning and evening wellness check-ins (1-5 scales: tiredness, mental drain, movement, hydration, late meal; sore muscles; journal) for one date.',
      inputSchema: z.object({
        date: z.string().nullable().describe('YYYY-MM-DD; null = today'),
      }),
      execute: async ({ date }) => {
        const d = date ?? todayIso
        const [morning, evening] = await Promise.all([
          repo.getDayCheckin(userId, d, 'morning'),
          repo.getDayCheckin(userId, d, 'evening'),
        ])
        return { date: d, morning, evening }
      },
    }),

    getReadinessExplanation: tool({
      description: "The app's own next-session recommendation engine output: which session it recommends today, its weighted scoring components (recovery/balance/freshness) and recovery signals. Use when asked why a session was recommended or what to train today.",
      inputSchema: z.object({}),
      execute: async () => {
        const rec = await repo.getNextSession(userId, tz)
        return {
          isRestDay: rec.isRestDay,
          recommendedSession: rec.session?.name ?? null,
          reason: rec.reason,
          weightedComponents: rec.weightedComponents ?? null,
          signals: rec.signals ?? null,
          deloadOrRestRecommended: rec.deloadOrRestRecommended ?? false,
          consecutiveTrainingDays: rec.consecutiveTrainingDays ?? 0,
        }
      },
    }),
  }
}
```

(If the repository interface export is aliased differently, confirm with `grep -n 'export interface' lib/data/repository.ts` — it is `WorkoutRepository`. `getRepositoryAsync()` in the route returns an implementation of it.)

- [ ] **Step 12.2: Convert the route to a tool loop.** In `app/api/ai-chat/route.ts`:
  - Imports: `import { streamText, stepCountIs } from 'ai'` and `import { buildChatTools } from '@/lib/ai-chat/tools'`.
  - **Delete** from the inline context: `workoutHistory`, `bodyMetricsSummary`, `nutritionSummary`, `capTrainingData`, and remove `buildWorkoutHistory`/`buildBodyMetricsSummary`/`buildNutritionSummary`/`capTrainingData` imports (also delete `MAX_TRAINING_DATA_CHARS` and its cap from `lib/ai-chat/context.ts` if now unused — `buildWorkoutHistory` etc. stay exported only if still imported elsewhere; if nothing imports them, delete them). Keep `repo.getWorkoutSessionsFrom` in the Promise.all — `filteredSessions` still feeds `buildWeekSchedule` and `build1RmTargets`.
  - **Drop** the now-unused `todayLogs`/`nutritionTargets` fetches from the Promise.all (the `getNutritionDay` tool covers them).
  - Inline context becomes: `[programSummary, weekSchedule, recoverySummary, oneRmTargets].join("\n\n")` (small, no cap needed).
  - Replace the `streamText` call:

```ts
    const result = streamText({
      model: google("gemini-3.1-flash-lite"),
      system: systemPrompt,
      messages,
      tools: buildChatTools(repo, userId, tz, todayIso),
      stopWhen: stepCountIs(6),
    });
```

  - Update the system prompt's data-source section:

```
// BEFORE
## Your data source
You have access to the user's training database with their full workout history and body metrics.
The data provided below is current and accurate — always use it to answer questions.
```

```
// AFTER
## Your data source
The message includes the active program, this week's schedule, today's recovery snapshot, and precomputed 1RMs.
For anything else — per-exercise history, PRs, nutrition, sleep/HRV/readiness ranges, check-ins, or why a session
was recommended — call the matching tool. Never answer from general gym knowledge when a tool can supply the
user's real data; call at most 3 tools per answer.
```

  - The response return is unchanged for now (`result.textStream.pipeThrough(...)` — Task 13 swaps it for the marker wrapper). `textStream` only carries text deltas, so the client's plain-text readers (`useCompletion` with `streamProtocol: "text"`, and the manual reader in `ai-chat-overlay.tsx`) keep working with zero changes while tool steps run silently.

- [ ] **Step 12.3: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep -E "ai-chat" ; pnpm test
git add lib/ai-chat/tools.ts app/api/ai-chat/route.ts lib/ai-chat/context.ts
git commit -m "Replace ai-chat's 10KB context dump with read-only tools

Every chat message shipped 90 days of history, truncated blindly at 10K chars.
The model now pulls exactly what a question needs via six repo-backed tools,
capped at 6 steps."
```

**Manual verification:** dev server → AI chat:
1. `Show my bench press progression over time` → server log should show a `getWorkoutsByExercise` call; answer must contain real dates/weights from the seed data and a `<sheet_chart>` block.
2. `What did I eat today?` → `getNutritionDay` call; totals match the Nutrition tab.
3. `Why is today's session recommended?` → `getReadinessExplanation`; quotes recovery/balance/freshness.
4. `What's my squat PR?` → `getPersonalRecords`.
Confirm streaming still renders progressively in the overlay (tool steps appear as a longer "Thinking…" pause, then text). Body-weight logging regex path (`log my weight as 82kg`) must still work — it runs before the model call and is untouched.

---

### Task 13: Mid-stream error handling on ai-chat + client detection (E5)

**Files:**
- Modify: `app/api/ai-chat/route.ts`
- Modify: `components/ai-chat-overlay.tsx`
- Modify: `components/chat.tsx`

- [ ] **Step 13.1: Route.** Replace the return in `app/api/ai-chat/route.ts`:

```ts
// BEFORE
    return new Response(result.textStream.pipeThrough(new TextEncoderStream()), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
```

```ts
// AFTER
    return textStreamResponse(result.textStream);
```

with `import { textStreamResponse } from '@/lib/ai/stream'`.

- [ ] **Step 13.2: Overlay client.** In `components/ai-chat-overlay.tsx`, add `import { splitStreamError } from '@/lib/ai/stream'` and change the read loop + finalisation in `sendMessage`:

```tsx
      let full = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        full += decoder.decode(value, { stream: true });
        setStreaming(splitStreamError(full).text);
      }

      const { text: finalText, errored } = splitStreamError(full);
      if (errored) {
        setMessages([...newMessages, {
          role: "assistant",
          content: finalText
            ? `${finalText}\n\n_⚠️ The response was cut short by a temporary AI service error — ask again to continue._`
            : "The AI service hit a temporary error before responding. Please try again.",
        }]);
      } else {
        setMessages([...newMessages, { role: "assistant", content: finalText }]);
      }
```

- [ ] **Step 13.3: Full-page chat client.** `components/chat.tsx` consumes the same route via `useCompletion({ streamProtocol: "text" })`, so the marker arrives inside `completion`. In its `onFinish` handler, before the existing content assignment, add:

```ts
import { splitStreamError } from "@/lib/ai/stream";
...
    onFinish: (_, completion) => {
      const { text: cleanCompletion, errored } = splitStreamError(completion);
      ...
          } else {
            content =
              (errored && cleanCompletion
                ? `${cleanCompletion}\n\n_⚠️ The response was cut short by a temporary AI service error — ask again to continue._`
                : cleanCompletion.trim()) ||
              "Sorry, I encountered an error. Make sure you have access to the sheet";
          }
```

Also find where `completion` is rendered live during streaming in `chat.tsx` (the assistant bubble bound to `completion`) and wrap it with `splitStreamError(completion).text` so the raw marker never flashes on screen.

- [ ] **Step 13.4: Verify + commit**

```bash
pnpm lint && npx tsc --noEmit 2>&1 | grep -E "ai-chat|chat.tsx" ; pnpm test
git add app/api/ai-chat/route.ts components/ai-chat-overlay.tsx components/chat.tsx
git commit -m "Surface mid-stream AI failures in chat instead of truncating silently

A 429 or provider blip after the first token used to end the answer mid-sentence
with no indication anything went wrong."
```

**Manual verification (failure simulation):** in the route, temporarily wrap the stream: `const brokenStream = (async function* () { let i = 0; for await (const c of result.textStream) { if (++i > 3) throw new Error('simulated 429'); yield c } })()` and pass `brokenStream` to `textStreamResponse`. Send a chat message → expect a few words followed by the "_cut short_" notice, never the literal `[[AI_STREAM_ERROR]]`. Revert the simulation before committing (the commit above must not contain it).

---

### Task 14: Full verification, docs, version bump

**Files:**
- Modify: `package.json` (version), `lib/changelog.ts`, `projectOverview.md`

- [ ] **Step 14.1: Full local test pass**

```bash
pnpm test && pnpm lint && pnpm build
```

- [ ] **Step 14.2: Dev-server sweep** (the standing rule: exercise every changed route before asking to merge):

```bash
pnpm db:local
unset DATABASE_URL DATABASE_SSL
pnpm dev
```

Log in as `test@local.dev` / `testpass123` and run every "Manual verification" block from Tasks 3–13. Minimum checklist:
- [ ] exercises/generate: `db ohp` normalises correctly
- [ ] nutrition/scan text path: totals ≈ ingredient sums; garbage input → "Could not identify food"
- [ ] builder-chat: swap request round-trips with styles enforced
- [ ] generate-program: 3-day hypertrophy program generates without parse errors
- [ ] prescribe: prescription returns (or noted as APK/staging-only if no ai_dynamic seed)
- [ ] health-insight: insight references labeled contributors
- [ ] session-explain: second load instant (DB cache row present)
- [ ] weekly summary card: generates, force-refreshes, caches per ISO week
- [ ] ai-chat: recovery answer, 1RM quote-only answer, all four tool calls, stream error simulation
- [ ] regression: body-weight logging via chat, chart blocks render, chat history survives

- [ ] **Step 14.3: Version + changelog + overview.** Bump `package.json` to the next **minor** (new user-visible capability: chat tools + recovery context + instant cached summaries). Add a `lib/changelog.ts` entry following the existing shape, e.g.:

```
AI upgrade: chat can now pull your real workout, recovery, nutrition and readiness data on demand and knows your Oura/sleep/check-in state; weekly summary and "why this session" load instantly after first generation; program/nutrition AI responses are schema-validated; interrupted AI answers now say so instead of stopping mid-sentence.
```

Tick the Batch E items (excluding quick-wins 6/7, marked deferred) in `projectOverview.md` per the tick-immediately rule, and update `docs/planned_upgrades.md` (mark E1–E5 shipped, note exclusions).

- [ ] **Step 14.4: Commit + PR**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/planned_upgrades.md
git commit -m "Bump version and changelog for the AI usage batch"
git push -u origin feat/batch-e-ai-usage
```

Open a PR titled `AI usage batch: structured output, response caching, chat tools, prompt hygiene, stream robustness`, offer to watch CI, and **ask the user for merge confirmation** ("Ready to merge to main and deploy?") — this is functional code, not a low-risk docs change.

---

## Self-review — sub-item coverage map

| Spec item | Where |
|---|---|
| E1 builder-chat → generateObject | Task 5 |
| E1 generate-program → generateObject | Task 6 |
| E1 exercises/generate → generateObject | Task 3 |
| E1 nutrition/scan → generateObject | Task 4 |
| E1 prescribe → generateObject w/ existing Zod schema | Task 7 |
| E2 weekly-digest cache by (userId, isoWeek) | Task 10 (ai_health_insights, section `weekly-digest`, date = ISO-week Monday) |
| E2 session-explain cache by (userId, programSessionId, date) | Task 9 (section `session-explain:{id}`) |
| E2 orphaned weekly-digest resolved (wiring option + HRV/readiness/PRs/per-muscle enrichment) | Task 10 (consumers grepped: only `weekly-ai-summary.tsx`, which called `/api/ai-chat`) |
| E3 stage 1: Oura/sleep/day-checkin context + Recovery block mirroring morning-briefing | Task 11 |
| E3 stage 1: precomputed 1RM/targets, "quote never recompute" replacing Epley | Task 11 |
| E3 stage 2: tool loop w/ `tool()` + `stopWhen`/`stepCountIs`, six read-only tools, dump removed | Task 12 |
| E4 generate-program/builder-chat ALWAYS-block deletion, compact JSON, `name\|muscles\|equip` lines | Tasks 5, 6 |
| E4 health-insight contributor pre-formatting | Task 8 |
| E4 scan: self-verify dropped, per-ingredient always, deterministic summing (sanitiseNutrition read + moved) | Task 4 |
| E5 mid-stream error marker on ai-chat + session-explain + client detection | Tasks 2, 9, 13 |
| E5 jittered retry helper `lib/ai/retry.ts` + unit test, applied to blocking routes | Tasks 1, 3–7, 10 |
| Exclusions stated (quick-wins 6+7, E6, D3) | Header |

**API-version check:** lockfile = `ai@6.0.214` / `@ai-sdk/google@3.0.86`; plan uses only `generateObject`, `streamText`, `tool({ inputSchema })`, `stopWhen: stepCountIs()`, `maxRetries`, `APICallError`/`NoObjectGeneratedError` — all present and identically-shaped in ai 5.x and 6.x (`inputSchema` replaced `parameters` in v5; `stopWhen` replaced `maxSteps` in v5). Task 1 Step 1.1 syncs the stale node_modules before any typing happens.
