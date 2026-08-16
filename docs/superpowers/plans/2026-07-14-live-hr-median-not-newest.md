# Live HR — Aggregate Beats, Never Surface the Newest Single Beat

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the live-HR readout from surfacing a single instantaneous beat per frame batch (the cause of the spiky in-workout/rest readings) and instead emit a robust median over the fresh beats we already receive — so a lone mis-decoded beat can never become the displayed number.

**Architecture:** The Oura ring already streams *batches* of beats per BLE frame (`0x80`/`0x60` `hr_bpm[]`, `0x86` `bpm[]`), but the live path (`lib/live-hr/decode-live-hr.ts` → `OuraRingSource.emitFrames`) throws the batch away and keeps only the newest single beat. Instantaneous beat-to-beat HR (`60000/IBI`) is naturally jumpy (respiratory sinus arrhythmia swings consecutive beats 10–20 bpm), so surfacing one beat looks spiky and lets one motion/decode artifact through unfiltered. This change replaces the "newest beat" selection with a **median over all fresh beats across the incoming frames** (bounded to a recent window), reusing the existing `median()` helper. No protocol/native change — it is a pure-TS decode-layer fix that ships via Railway with **no APK rebuild**.

**Tech Stack:** TypeScript, Vitest, existing pure helpers in `lib/health/hr-smoothing.ts` (`median`), the byte-exact frame decoder in `lib/oura-ble/decode.ts` (`historyEventFromHex`).

---

## Background — why "newest" is the bug (read before starting)

The live-HR pipeline today:

1. Native BLE service delivers ring frames to JS via `ouraFrames`/`ouraFrame` (each frame carries a *batch* of beats sharing one ring timestamp).
2. `lib/live-hr/decode-live-hr.ts::latestBpmWithTsFromFrames()` decodes them and returns the **single** beat with the greatest ring timestamp — and within that frame, `latestValidBpm()` returns only the **last** array element (`decode-live-hr.ts:9-16, 33-45`).
3. `OuraRingSource.emitFrames()` (`lib/live-hr/oura-ring-source.ts:80-106`) surfaces that one beat as the current bpm.
4. The workout orchestrator samples the current bpm at 1 Hz into the trace buffer (`components/workout-screen.tsx:500-511`), and `LiveHrChart` applies a light `rollingMedian(…, 3)` at render (`components/workout/live-hr-chart.tsx:52`).

The spikiness is not data scarcity — the beats to smooth against **already arrive** in each batch; we discard them and keep one. The fix is to aggregate the batch we already have. We use a **median** (not an arithmetic mean) deliberately: a single artifact beat (e.g. a missed beat → doubled IBI → halved HR) skews a mean but not a median. This matches the codebase's existing rationale — see the comment on `rollingMedian` in `lib/health/hr-smoothing.ts:49-53` ("robust to single-beat outliers … unlike a mean").

### Design decisions (locked)

- **Aggregate = median** over the fresh beats. Reuse `median()` from `lib/health/hr-smoothing.ts` (One Formula, One Place — do not write a new median).
- **Window bound**: median the most-recent `HR_AVG_WINDOW_BEATS = 10` fresh beats (ordered by ring timestamp). This bounds the case where the first history drain after connect pulls a large backlog — we never blend minutes of history into one "now" value; we track the recent window.
- **Freshness/dedup preserved**: only beats from frames with `ringTs > afterRingTs` count, so a re-drained old tail contributes nothing (identical semantics to today's `lastRingTs` guard, just applied to the whole batch instead of one beat).
- **Remove the "newest" functions.** `latestBpmFromFrames` / `latestBpmWithTsFromFrames` / `latestValidBpm` are replaced, not kept. Leaving a function literally named `latest…` around would invite re-introducing the exact anti-pattern we're removing. Grep confirms the only non-test caller is `oura-ring-source.ts` (changed here); the only other references are historical plan docs.

### What this does NOT change

- No native/Kotlin change; no burst cadence change (`BURST_INTERVAL_MS`/`DRAIN_INTERVAL_MS` stay). The burst is already the fastest firing mechanism and remains engaged across the whole active phase.
- The render-time `rollingMedian(…, 3)` in `LiveHrChart` stays as-is (it now smooths an already-robust series — layered, harmless). Do not widen it in this plan (YAGNI).
- The trace-ingest plausibility gate (`isPlausibleHrSample` in `exercise-trace.ts:47`) stays.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/live-hr/decode-live-hr.ts` | Pure extraction of a robust current BPM from a batch of ring frames | **Rewrite**: replace newest-beat selection with `smoothedBpmFromFrames()` (median over fresh-beat window) |
| `lib/live-hr/__tests__/decode-live-hr.test.ts` | Unit tests for the pure decoder | **Rewrite**: test median-not-newest + misreading rejection + window bound + freshness guard |
| `lib/live-hr/oura-ring-source.ts` | Wires plugin frames → sample callback | **Modify** `emitFrames` (lines 80-106) + import to call `smoothedBpmFromFrames` |

---

### Task 1: Replace the pure decoder — median over fresh beats, not the newest one

**Files:**
- Modify/Rewrite: `lib/live-hr/decode-live-hr.ts`
- Test: `lib/live-hr/__tests__/decode-live-hr.test.ts`

- [ ] **Step 1: Rewrite the test file to specify the new behavior (failing test)**

Replace the entire contents of `lib/live-hr/__tests__/decode-live-hr.test.ts` with:

```ts
import { describe, it, expect } from 'vitest'
import { smoothedBpmFromFrames } from '@/lib/live-hr/decode-live-hr'

// Build a ring history-event frame hex: tag + length + payload, where payload is
// a 4-byte LE deciseconds timestamp followed by the event body. Mirrors the format
// historyEventFromHex() expects (see lib/oura-ble/decode.ts parseHistoryEvent).
function frameHex(tag: number, ds: number, body: number[]): string {
  const ts = [ds & 0xff, (ds >> 8) & 0xff, (ds >> 16) & 0xff, (ds >> 24) & 0xff]
  const payload = [...ts, ...body]
  return [tag, payload.length, ...payload].map(b => b.toString(16).padStart(2, '0')).join('')
}

// aohr (0x86) body: flag, base_offset, count, then count×(bpm,quality) pairs.
function aohrBody(bpms: number[]): number[] {
  const pairs = bpms.flatMap(b => [b, 1])
  return [0x01, 0x00, bpms.length, ...pairs]
}

describe('smoothedBpmFromFrames', () => {
  it('returns null for no frames', () => {
    expect(smoothedBpmFromFrames([], 0)).toBeNull()
  })

  it('medians the whole batch — NOT the newest single beat', () => {
    // Six beats in one aohr frame: [50,51,52,53,54,55]. The old code returned 55
    // (newest). Median of the six is 53 (sorted[3]). Proves we no longer surface newest.
    const res = smoothedBpmFromFrames([frameHex(0x86, 1000, aohrBody([50, 51, 52, 53, 54, 55]))], 0)
    expect(res).toEqual({ bpm: 53, ringTs: 1000 })
  })

  it('rejects a lone artifact beat via the median', () => {
    // Three steady beats at ts 1000, then a single motion artifact (45) at ts 2000.
    // Newest-beat logic would surface 45; the median of [45,120,121,122] is 121.
    const steady = frameHex(0x86, 1000, aohrBody([120, 122, 121]))
    const artifact = frameHex(0x86, 2000, aohrBody([45]))
    const res = smoothedBpmFromFrames([steady, artifact], 0)
    expect(res).toEqual({ bpm: 121, ringTs: 2000 })
  })

  it('only counts beats newer than afterRingTs (re-drained tail is ignored)', () => {
    // Frame ts 1000 already surfaced (afterRingTs = 1000) → no fresh beats → null.
    expect(smoothedBpmFromFrames([frameHex(0x86, 1000, aohrBody([70, 72]))], 1000)).toBeNull()
  })

  it('advances ringTs to the greatest fresh frame timestamp', () => {
    const older = frameHex(0x86, 1500, aohrBody([80]))
    const newer = frameHex(0x86, 3000, aohrBody([82]))
    const res = smoothedBpmFromFrames([newer, older], 1000)
    // Beats [80,82] (ts order) → median sorted[1] = 82; ringTs = max = 3000.
    expect(res).toEqual({ bpm: 82, ringTs: 3000 })
  })

  it('bounds the median to the most recent window of beats', () => {
    // 12 fresh beats but window is 10: the two oldest (200,200) must be excluded so
    // the median tracks the recent value, not a stale backlog.
    const old = frameHex(0x86, 1000, aohrBody([200, 200])) // excluded by the window
    const recent = frameHex(0x86, 2000, aohrBody([60, 60, 60, 60, 60, 61, 61, 61, 61, 61]))
    const res = smoothedBpmFromFrames([old, recent], 0)
    expect(res?.bpm).toBe(61) // median of ten 60/61 values (sorted[5]) = 61, not skewed by 200s
  })

  it('decodes green_ibi (0x80) frames', () => {
    // b0=0x4b, b1=0x08 → ibi=(0)|(0x4b<<3)=600, quality=1 → 60000/600 = 100 bpm.
    const res = smoothedBpmFromFrames([frameHex(0x80, 1000, [0x4b, 0x08])], 0)
    expect(res).toEqual({ bpm: 100, ringTs: 1000 })
  })

  it('drops out-of-range beats before medianing', () => {
    // count=1, bpm=250 (>220) → no valid beat → null.
    expect(smoothedBpmFromFrames([frameHex(0x86, 1000, aohrBody([250]))], 0)).toBeNull()
  })

  it('ignores non-HR frames', () => {
    const hr = frameHex(0x86, 1000, aohrBody([66, 68]))
    const junk = frameHex(0x84, 1001, [0x10, 0x00]) // ambient_event — no HR
    const res = smoothedBpmFromFrames([hr, junk], 0)
    expect(res).toEqual({ bpm: 68, ringTs: 1000 }) // median of [66,68] sorted[1] = 68
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- decode-live-hr`
Expected: FAIL — `smoothedBpmFromFrames` is not exported (module still exports `latestBpmFromFrames`/`latestBpmWithTsFromFrames`).

- [ ] **Step 3: Rewrite the decoder implementation**

Replace the entire contents of `lib/live-hr/decode-live-hr.ts` with:

```ts
// lib/live-hr/decode-live-hr.ts
// Pure extraction of a robust current live BPM from ring history-event frames.
// Each ring frame carries a BATCH of beats (0x80/0x60 hr_bpm[], 0x86 bpm[]); we
// median the recent fresh beats rather than surface any single "newest" beat, so a
// lone motion/decode artifact can never become the displayed value. Reuses the
// byte-exact decoder in @/lib/oura-ble/decode and the shared median() (One Formula).
import { historyEventFromHex } from '@/lib/oura-ble/decode'
import { median } from '@/lib/health/hr-smoothing'

const MIN_BPM = 30
const MAX_BPM = 220

// Median over at most this many of the most-recent fresh beats. Bounds the first
// post-connect history drain so a large backlog can't blend minutes into one value,
// while still smoothing beat-to-beat HRV. ~10 beats ≈ a 6–10 s window at rest.
export const HR_AVG_WINDOW_BEATS = 10

function validBpms(values: unknown): number[] {
  if (!Array.isArray(values)) return []
  return values.filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= MIN_BPM && v <= MAX_BPM,
  )
}

// A frame decodes either an aohr `bpm[]` (0x86) or an IBI/HRV `hr_bpm[]` (0x80/0x60/0x5d).
function bpmsFromDecoded(decoded: Record<string, unknown>): number[] {
  const fromBpm = validBpms(decoded.bpm)
  return fromBpm.length ? fromBpm : validBpms(decoded.hr_bpm)
}

/**
 * Given a batch of raw frame hex strings (as delivered by the native service's
 * `ouraFrames`/`ouraFrame` events), return a robust current BPM and the greatest
 * contributing ring timestamp — or null if no frame newer than `afterRingTs`
 * carries a usable beat.
 *
 * The BPM is the median of the most-recent `HR_AVG_WINDOW_BEATS` valid beats across
 * all fresh frames (frames with ring timestamp > `afterRingTs`), ordered by ring
 * timestamp. Never the single newest beat — that is the point: a one-off artifact
 * cannot move the readout.
 */
export function smoothedBpmFromFrames(
  frameHexes: string[],
  afterRingTs: number,
  windowBeats: number = HR_AVG_WINDOW_BEATS,
): { bpm: number; ringTs: number } | null {
  const fresh: { ts: number; bpms: number[] }[] = []
  let maxRingTs = afterRingTs
  for (const hex of frameHexes) {
    const ev = historyEventFromHex(hex)
    if (!ev || !ev.decoded) continue
    if (ev.timestampDs <= afterRingTs) continue // already surfaced — skip re-drained tails
    const bpms = bpmsFromDecoded(ev.decoded as Record<string, unknown>)
    if (bpms.length === 0) continue
    fresh.push({ ts: ev.timestampDs, bpms })
    if (ev.timestampDs > maxRingTs) maxRingTs = ev.timestampDs
  }
  if (fresh.length === 0) return null
  fresh.sort((a, b) => a.ts - b.ts)
  const beats = fresh.flatMap(f => f.bpms)
  const window = beats.slice(-windowBeats)
  return { bpm: median(window), ringTs: maxRingTs }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- decode-live-hr`
Expected: PASS — all cases in the rewritten test file green.

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/decode-live-hr.ts lib/live-hr/__tests__/decode-live-hr.test.ts
git commit -m "Live HR: median fresh beats instead of surfacing the newest single beat"
```

---

### Task 2: Wire `OuraRingSource` to the median decoder

**Files:**
- Modify: `lib/live-hr/oura-ring-source.ts:12` (import) and `:80-106` (`emitFrames`)

- [ ] **Step 1: Update the import**

In `lib/live-hr/oura-ring-source.ts`, replace line 12:

```ts
import { latestBpmWithTsFromFrames } from '@/lib/live-hr/decode-live-hr'
```

with:

```ts
import { smoothedBpmFromFrames } from '@/lib/live-hr/decode-live-hr'
```

- [ ] **Step 2: Update `emitFrames` to use the median decoder**

In `lib/live-hr/oura-ring-source.ts`, replace the decode/guard block inside `emitFrames` — the current lines 93-105:

```ts
    const latest = latestBpmWithTsFromFrames(frames.map(f => f.hex))
    if (latest == null) return
    this.diag.decodeHits++
    // Near-live guard: surface a beat only when a newly-recorded one arrives (ring
    // timestamp advances). A re-drained old tail must not re-stamp the readout as
    // fresh, or the hook's staleness guard could never blank a stalled feed.
    if (latest.ringTs <= this.lastRingTs) return
    this.lastRingTs = latest.ringTs
    this.diag.lastBpm = latest.bpm
    this.diag.lastBpmAt = Date.now()
    const sample = { bpm: latest.bpm, at: Date.now() }
    this.state = 'connected'
    for (const l of this.listeners) l(sample)
```

with:

```ts
    // Median over the recent fresh beats (never a single newest beat) — a lone
    // motion/decode artifact can't move the readout. smoothedBpmFromFrames returns
    // null when no frame newer than lastRingTs carries a usable beat, which also
    // enforces the near-live guard (a re-drained old tail contributes nothing, so a
    // stalled feed stays blank for the hook's staleness gate).
    const smoothed = smoothedBpmFromFrames(frames.map(f => f.hex), this.lastRingTs)
    if (smoothed == null) return
    this.diag.decodeHits++
    this.lastRingTs = smoothed.ringTs
    this.diag.lastBpm = smoothed.bpm
    this.diag.lastBpmAt = Date.now()
    const sample = { bpm: smoothed.bpm, at: Date.now() }
    this.state = 'connected'
    for (const l of this.listeners) l(sample)
```

- [ ] **Step 3: Run the live-HR test suite + typecheck to verify nothing regressed**

Run: `pnpm test -- live-hr && pnpm exec tsc --noEmit`
Expected: PASS — decode-live-hr tests green, `manager.test.ts` still green, no type errors (the old `latestBpmWithTsFromFrames` import is gone and nothing else references it).

- [ ] **Step 4: Confirm no stale references remain**

Run: `git grep -nE 'latestBpm(With Ts)?FromFrames|latestValidBpm' -- 'lib/**' 'components/**' 'app/**'`
Expected: no matches outside `docs/` (historical plan docs may still mention the old names — those are frozen history, leave them).

- [ ] **Step 5: Commit**

```bash
git add lib/live-hr/oura-ring-source.ts
git commit -m "Live HR: source emits the median fresh reading, not the newest beat"
```

---

### Task 3: Full gate + record device-verification status

**Files:** none (verification only) — plus the end-of-session journal/index update per CLAUDE.md (done in this same PR, last).

- [ ] **Step 1: Run the full CI gate locally**

Run: `pnpm lint && pnpm exec tsc --noEmit && pnpm test && pnpm build`
Expected: all green.

- [ ] **Step 2: Dev-server sanity (web sandbox — logic path only)**

Run `pnpm dev` and open the workout flow. Note the expected behavior: on web/dev the ring is absent (`getOuraBle()` returns null), so `OuraRingSource` is inert and the Live HR card shows "Waiting for your ring…". This confirms **no crash / no regression in the render path**; it does **not** exercise real frame decoding (there are no frames without a device). This is expected — the decode change is covered by the Task 1 unit tests, not the dev server.

- [ ] **Step 3: Write the device-verification status into the PR / journal**

Because this is a live-HR (BLE) behavior change, per CLAUDE.md the real merge gate is on-device. State explicitly in the PR body and the session journal:

> Verified: unit tests (median/artifact-rejection/window/freshness) + full gate green; dev-server render path unbroken. NOT verified in sandbox (no BLE frames): the on-device smoothness of the rest-window readout. On-device check: during a workout rest, open the live-HR **diagnostics panel** (`getDiagnostics()` — `framesSeen`/`hrFramesSeen`/`decodeHits`) and confirm the displayed bpm tracks smoothly (no single-beat spikes) while `decodeHits` advances. Use the diagnostics counters to confirm multiple HR frames arrive per burst; if they are sparse, revisit `HR_AVG_WINDOW_BEATS`.

Add a `projectOverview.md` Known-Issues row marking the change **not yet device-verified** if no device run happens in-session.

- [ ] **Step 4: Version bump + changelog (user-visible smoothness change)**

Bump the patch version in `package.json` and add an entry to `lib/changelog.ts` (patch — a bug fix): "Live heart rate reads smoother during workouts (averages recent beats instead of the last one)." Fold this and the journal/`projectOverview.md` update into this same PR before merge, per CLAUDE.md.

- [ ] **Step 5: Commit the bookkeeping**

```bash
git add package.json lib/changelog.ts projectOverview.md docs/overview/history-*.md
git commit -m "Docs/version: live-HR beat-averaging smoothing"
```

---

## Self-Review

**Spec coverage** (user requirement: *"never use newest and always use the average to account for misreadings"*):
- "Never use newest" → `latestBpmFromFrames`/`latestBpmWithTsFromFrames`/`latestValidBpm` removed; Task 1 Step 1 test `medians the whole batch — NOT the newest single beat` asserts it directly (expects 53, not 55). ✅
- "Always use the average to account for misreadings" → `smoothedBpmFromFrames` medians the fresh-beat window; the `rejects a lone artifact beat via the median` test proves a 45-bpm artifact is discarded. Median chosen over mean precisely because it rejects misreadings (rationale documented). ✅
- Applied at the source of truth (the decode layer) so **every** consumer (live number, trace, sparkline) inherits it, not just one screen. ✅

**Placeholder scan:** every code step contains complete code; every command has an expected result. No TBD/TODO. ✅

**Type consistency:** `smoothedBpmFromFrames(frameHexes: string[], afterRingTs: number, windowBeats?: number): { bpm: number; ringTs: number } | null` is defined in Task 1 and called with that exact shape in Task 2 (`smoothedBpmFromFrames(frames.map(f => f.hex), this.lastRingTs)`), and its return is consumed as `smoothed.bpm`/`smoothed.ringTs` matching the definition. `median` is imported from `@/lib/health/hr-smoothing` (exists). `historyEventFromHex` returns `{ decoded, timestampDs }` as used (matches `lib/oura-ble/decode.ts` and the existing test's `frameHex` layout). ✅

**Risk / not-covered:** exact on-device per-burst frame density is unobservable in the sandbox — if bursts deliver very few beats, the window median degrades toward the old behavior; the on-device diagnostics check in Task 3 Step 3 is the mitigation, and `HR_AVG_WINDOW_BEATS` is a single tunable constant.
