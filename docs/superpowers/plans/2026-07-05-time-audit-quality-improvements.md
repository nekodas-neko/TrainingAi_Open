# Admin Time Audit: Quality Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Context:** Three small gaps found while reviewing the admin Time Audit tool
(`lib/workout/time-audit.ts` + `/api/admin/time-audit` + `components/admin/time-audit-card.tsx`,
shipped session 186 / PR #136) during this session's investigation into whether the
`duration-model.ts` transition assumptions (240s/120s/60s) are realistic. None of
these are bugs in the audit math itself (`robustStats`'s outlier exclusion is
correct) — they're gaps in how the tool presents/scopes its numbers that make it
easy to over-trust a thin or noisy sample.

**Fixes (three independent, low-risk, admin-tool-only changes — no schema, no
production-user-facing surface):**

1. **Days window is hardcoded to 90** — the card always calls
   `/api/admin/time-audit?days=90` even though the API already supports 7–365. Add
   a selector so an admin reviewing a low-frequency exercise (or wanting the full
   year) isn't stuck at 90 days.
2. **No low-sample-size signal** — every median renders with equal visual weight
   whether it's backed by 2 sets or 50. Dim/flag rows below a trust threshold so a
   thin sample doesn't read as confidently as a real one.
3. **Degenerate near-zero sessions pollute "Recent sessions"** — sessions like a
   16s or 34s "workout" (clearly an accidental open/immediate-quit, not real
   training) show up in the per-session breakdown table with no way to tell them
   apart from real sessions at a glance. `decomposeSessions()` only filters on
   `completedAt != null`; add a minimum realistic duration.

**Tech Stack:** Next.js 15, TypeScript, vitest. No DB/migration changes.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/workout/time-audit.ts` | Modify | Add `MIN_TRUSTED_SAMPLES` constant + export; add minimum-duration filter to `decomposeSessions` |
| `lib/__tests__/time-audit.test.ts` | Modify | Tests for the new filter + constant |
| `app/api/admin/time-audit/route.ts` | No change needed | Already supports `days` 7–365 — confirmed by reading; this plan only wires the existing param into the UI |
| `components/admin/time-audit-card.tsx` | Modify | Days selector; low-sample dimming |

---

### Task 1: Days selector in the admin card

**Files:**
- Modify: `components/admin/time-audit-card.tsx`

No test — this is a UI-only change to an admin tool with no existing component-test
infra (consistent with the rest of this component). Verify manually (Step 3).

- [ ] **Step 1: Add state + a small selector row**

In `components/admin/time-audit-card.tsx`:

1. Add `const [days, setDays] = useState(90)` alongside the existing `open`/`loading`/`data`/`error` state.
2. Change `load()` to accept an optional override and use `days` otherwise:
```tsx
  async function load(d = days) {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/time-audit?days=${d}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setData(await res.json())
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }
```
3. Update the initial-load call site (`if (!open && !data && !loading) load()`) — no change needed, it already uses the default param.
4. Update the header text from the hardcoded `Workout time audit (90 days)` to
   `Workout time audit ({days} days)` (template literal).
5. Add a small button row (30 / 90 / 180 / 365) directly under the header, visible
   only when `open`, that calls `setDays(d); load(d);` per option — style to match
   the existing compact `text-xs` admin-card aesthetic (reuse the existing
   `Button size="sm" variant="ghost"` pattern already used for the Retry button).
   Highlight the active selection (e.g. `variant={days === d ? 'secondary' : 'ghost'}`).

- [ ] **Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 3: Manual verification against the local dev DB**

`pnpm dev`, open Admin → Tools → Time Audit, confirm: default still loads 90 days;
clicking 30/180/365 refetches and updates the header + tables; clicking the
already-active option doesn't spam a redundant refetch (acceptable if it does — not
worth extra state to prevent, just confirm it doesn't error).

- [ ] **Step 4: Commit**

```bash
git add components/admin/time-audit-card.tsx
git commit -m "feat: days selector for the admin time-audit card"
```

---

### Task 2: Low-sample-size visual signal

**Files:**
- Modify: `lib/workout/time-audit.ts`
- Modify: `components/admin/time-audit-card.tsx`

- [ ] **Step 1: Write the failing test**

Add to `lib/__tests__/time-audit.test.ts`:

```ts
import { MIN_TRUSTED_SAMPLES } from '../workout/time-audit'
// (fold into the existing top-of-file import list if one already exists)

describe('MIN_TRUSTED_SAMPLES', () => {
  it('is a small positive threshold below which a median should be treated as unreliable', () => {
    expect(MIN_TRUSTED_SAMPLES).toBeGreaterThan(0)
    expect(MIN_TRUSTED_SAMPLES).toBeLessThanOrEqual(10)
  })
})
```

(This is deliberately a thin test — the constant itself is a judgment call, not a
formula; the real verification is the UI treatment in Step 3 below.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: FAIL — `MIN_TRUSTED_SAMPLES` is not exported

- [ ] **Step 3: Write the implementation**

1. In `lib/workout/time-audit.ts`, add near the top (after `RobustStats`):
```ts
// Below this many kept samples, a median is a guess, not a signal — the UI dims
// the number rather than hiding it (a thin sample is still worth seeing, just not
// worth trusting at face value).
export const MIN_TRUSTED_SAMPLES = 5
```

2. In `components/admin/time-audit-card.tsx`, add a small helper near the top:
```tsx
import { /* existing imports */ } from '...'
const MIN_TRUSTED_SAMPLES = 5 // mirrors lib/workout/time-audit.ts — import it directly instead of redeclaring if this file already imports from that module
```
   (Prefer importing the constant from `lib/workout/time-audit.ts` directly rather
   than redeclaring it, if the card can import server-side lib code — confirm this
   module has no server-only imports before importing directly; it's pure
   functions/constants, so it should be safe. If there's any reason it can't be
   imported client-side, redeclare with a comment pointing at the source of truth
   and a note to keep them in sync.)

3. Apply dimming wherever a sample count gates a displayed median — the equipment
   table (`r.transitionCount`), the per-exercise table (`r.setCount`,
   `r.transitionCount`), using a shared class, e.g.:
```tsx
const lowN = (n: number) => n > 0 && n < MIN_TRUSTED_SAMPLES ? 'opacity-50' : ''
```
   and apply `className={lowN(r.transitionCount)}` (or similar) to the relevant
   `<td>` cells. Don't dim `n === 0` (`—` already communicates "no data" clearly
   enough on its own) — only dim the thin-but-nonzero case, which is the one that
   currently looks deceptively confident.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck + lint + manual verification**

Run: `npx tsc --noEmit && pnpm lint`. Then `pnpm dev`, open the Time Audit card
against local dev DB data (seed data has thin samples for several exercises —
confirm rows with `n` in the 1–4 range visually dim while higher-n rows don't).

- [ ] **Step 6: Commit**

```bash
git add lib/workout/time-audit.ts components/admin/time-audit-card.tsx
git commit -m "feat: dim low-sample-count medians in the admin time-audit card"
```

---

### Task 3: Filter degenerate sessions out of the per-session breakdown

**Files:**
- Modify: `lib/workout/time-audit.ts`
- Modify: `lib/__tests__/time-audit.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `lib/__tests__/time-audit.test.ts`:

```ts
describe('decomposeSessions — degenerate session filtering', () => {
  it('excludes sessions shorter than the minimum realistic duration', () => {
    const sessions = [
      { workoutSessionId: 'a', startedAt: 0, completedAt: 16_000, warmupEndedAt: null },   // 16s — junk
      { workoutSessionId: 'b', startedAt: 0, completedAt: 45 * 60_000, warmupEndedAt: null }, // 45min — real
    ]
    const result = decomposeSessions(sessions, [], [])
    expect(result.map(r => r.workoutSessionId)).toEqual(['b'])
  })

  it('keeps a short-but-plausible single-exercise session (does not over-filter)', () => {
    const sessions = [
      { workoutSessionId: 'c', startedAt: 0, completedAt: 3 * 60_000, warmupEndedAt: null }, // 3min
    ]
    expect(decomposeSessions(sessions, [], []).map(r => r.workoutSessionId)).toEqual(['c'])
  })
})
```

(Add `decomposeSessions` to the existing top-of-file import list if it isn't
already imported.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: FAIL — the 16s session is still present in the result

- [ ] **Step 3: Write the implementation**

In `lib/workout/time-audit.ts`, add near the top (after `MIN_TRUSTED_SAMPLES`):
```ts
// A "session" shorter than this is an accidental open/immediate-quit tap, not a
// real workout — even a single solo-logged set takes longer than this in practice.
// Chosen conservatively (well under any plausible single-set session) so a real,
// unusually short session is never dropped.
export const MIN_SESSION_SEC = 120
```

Update `decomposeSessions`'s filter (currently `.filter(ws => ws.completedAt != null)`):
```ts
  return sessions
    .filter(ws => ws.completedAt != null && (ws.completedAt - ws.startedAt) / 1000 >= MIN_SESSION_SEC)
    .map(ws => {
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run lib/__tests__/time-audit.test.ts`
Expected: PASS (both new tests + all pre-existing `decomposeSessions` tests)

- [ ] **Step 5: Run the full suite + typecheck**

Run: `pnpm test && npx tsc --noEmit && pnpm lint`
Expected: all green.

- [ ] **Step 6: Manual verification against the local dev DB**

Insert a throwaway 20-second fake session for the test user (`INSERT INTO
workout_sessions ...` with `completed_at = started_at + interval '20 seconds'`),
confirm it no longer appears in the admin card's "Recent sessions" table, then
delete the throwaway row.

- [ ] **Step 7: Commit**

```bash
git add lib/workout/time-audit.ts lib/__tests__/time-audit.test.ts
git commit -m "fix: exclude degenerate near-zero-length sessions from the time-audit breakdown"
```
