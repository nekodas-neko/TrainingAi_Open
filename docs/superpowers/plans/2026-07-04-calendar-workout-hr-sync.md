# Calendar Workout HR Sync (finding U2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make the Health calendar day-detail sheet re-pull Oura HR for a past workout (like the Done screen already does) so a session where the ring was worn stops showing "No HR data" forever, and give sessions that were never completed a distinct message.

**Architecture:** The day-detail sheet's HR block calls `loadSessionHr` (`app/health/health-content.tsx:499-513`), which does a **read-only** `GET /api/oura/hr-data?sessionId=…`. Rows only exist in `oura_heartrate` if something previously POSTed `/api/oura/hr-sync` (`lib/oura/hr-sync.ts` → `syncHrForSession`); the calendar never triggers that sync, so a missed/late one-shot completion sync leaves the ±10-min window join empty permanently. Fix: `loadSessionHr` POSTs `hr-sync` before the GET (mirroring `components/workout/done-screen.tsx:92-111`) while the block shows its existing loading skeleton — the sheet is already painted, so nothing blocks. A pure classifier maps the response to a UI sentinel, adding an `'incomplete'` state (route returns `{ ready: false }` for `completedAt == null`) that renders a message distinct from the worn/synced one.

**Tech Stack:** Next.js 15 / React 19 / TypeScript, vitest (`pnpm test`), Drizzle/Postgres. Verification also uses `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build`.

---

### Task 1: Pure HR-response classifier + message helper (TDD)

Extract the response→sentinel decision (currently inline at `health-content.tsx:505-509`) into a pure, unit-testable module so the new `'incomplete'` branch is covered by a test.

**Files:**
- Create: `lib/workout/hr-session-state.ts`
- Test: `lib/workout/__tests__/hr-session-state.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/workout/__tests__/hr-session-state.test.ts`
```ts
import { describe, it, expect } from "vitest";
import { classifyHrResponse, hrEmptyMessage } from "../hr-session-state";

describe("classifyHrResponse", () => {
  it("returns 'incomplete' when the route reports the session is not completed", () => {
    expect(classifyHrResponse({ ready: false })).toBe("incomplete");
  });

  it("returns 'none' when the session is ready but the Oura window had no readings", () => {
    expect(classifyHrResponse({ ready: true, hasData: false, readings: [] })).toBe("none");
  });

  it("returns 'none' when ready+hasData but readings are missing", () => {
    expect(classifyHrResponse({ ready: true, hasData: true })).toBe("none");
  });

  it("returns the parsed data object when readings are present", () => {
    const data = {
      ready: true,
      hasData: true,
      startedAt: "2026-07-01T10:00:00.000Z",
      readings: [{ timestamp: "2026-07-01T10:01:00.000Z", bpm: 120 }],
      setStats: [{ exerciseName: "Bench", setNumber: 1, loggedAt: null, hrr1: 22, adequate: true }],
    };
    const result = classifyHrResponse(data);
    expect(result).not.toBe("none");
    expect(result).not.toBe("incomplete");
    expect(result).toMatchObject({
      hasData: true,
      startedAt: "2026-07-01T10:00:00.000Z",
      readings: [{ timestamp: "2026-07-01T10:01:00.000Z", bpm: 120 }],
      setStats: [{ exerciseName: "Bench", setNumber: 1 }],
    });
  });
});

describe("hrEmptyMessage", () => {
  it("gives a distinct message for a session that was never completed", () => {
    expect(hrEmptyMessage("incomplete")).toBe(
      "This workout wasn't marked complete, so there's no HR recovery to show",
    );
  });

  it("keeps the worn/synced message for a completed session with no readings", () => {
    expect(hrEmptyMessage("none")).toBe("No HR data — ensure Oura was worn and synced");
  });
});
```

- [ ] **Step 2: Run it, verify FAIL** — Run: `pnpm test lib/workout/__tests__/hr-session-state.test.ts` (fails: module does not exist yet).

- [ ] **Step 3: Implement**

`lib/workout/hr-session-state.ts`
```ts
// Shape of one session's HR-recovery payload from GET /api/oura/hr-data.
export interface SessionHrData {
  hasData: boolean;
  startedAt: string;
  readings: { timestamp: string; bpm: number }[];
  setStats: {
    exerciseName: string;
    setNumber: number;
    loggedAt: string | null;
    hrr1: number | null;
    adequate: boolean | null;
  }[];
}

// Raw JSON from GET /api/oura/hr-data. `ready:false` means the session has no
// completedAt (app/api/oura/hr-data/route.ts:17); otherwise `hasData` reflects
// whether the ±10-min window join returned any readings.
export interface HrDataResponse {
  ready?: boolean;
  hasData?: boolean;
  startedAt?: string;
  readings?: { timestamp: string; bpm: number }[];
  setStats?: SessionHrData["setStats"];
}

// UI sentinel for a session's HR-recovery block.
// 'loading'    — sync/read in flight
// 'incomplete' — session never completed (route returned ready:false); distinct from 'none'
// 'none'       — session completed but the Oura window produced no readings
export type HrSessionState = SessionHrData | "loading" | "none" | "incomplete";

export function classifyHrResponse(data: HrDataResponse): SessionHrData | "none" | "incomplete" {
  if (data.ready === false) return "incomplete";
  if (data.ready && data.hasData && data.readings) {
    return {
      hasData: true,
      startedAt: data.startedAt ?? "",
      readings: data.readings,
      setStats: data.setStats ?? [],
    };
  }
  return "none";
}

export function hrEmptyMessage(state: "none" | "incomplete"): string {
  return state === "incomplete"
    ? "This workout wasn't marked complete, so there's no HR recovery to show"
    : "No HR data — ensure Oura was worn and synced";
}
```

- [ ] **Step 4: Run test, verify PASS** — Run: `pnpm test lib/workout/__tests__/hr-session-state.test.ts`

- [ ] **Step 5: Commit** — `git add lib/workout/hr-session-state.ts lib/workout/__tests__/hr-session-state.test.ts && git commit -m "Add HR-recovery response classifier with distinct not-completed state"`

---

### Task 2: Calendar HR block re-pulls Oura before reading, and shows a distinct not-completed message

Rewire `loadSessionHr` to POST `hr-sync` before the GET (mirroring the Done screen), consume the Task 1 classifier, allow a retry on a subsequent expand, and render the `'incomplete'` message. This is a UI change with no unit surface of its own (the decision logic is covered by Task 1) — verify against the dev server.

**Files:**
- Modify: `app/health/health-content.tsx:154-160` (remove local `SessionHrData` interface, import types, widen state to include `'incomplete'`)
- Modify: `app/health/health-content.tsx:499-513` (`loadSessionHr`)
- Modify: `app/health/health-content.tsx:933-934` (render the `'incomplete'` message; exclude it from the data-render guard)

- [ ] **Step 1: Add the import.** Add to the existing import block near the top of `app/health/health-content.tsx` (place beside the other `@/lib/...` imports):
```ts
import { classifyHrResponse, hrEmptyMessage, type SessionHrData, type HrSessionState, type HrDataResponse } from "@/lib/workout/hr-session-state";
```

- [ ] **Step 2: Delete the local `SessionHrData` interface and widen the state type.** Replace the current block at `app/health/health-content.tsx:154-160`:
```ts
  interface SessionHrData {
    hasData: boolean;
    startedAt: string;
    readings: { timestamp: string; bpm: number }[];
    setStats: { exerciseName: string; setNumber: number; loggedAt: string | null; hrr1: number | null; adequate: boolean | null }[];
  }
  const [sessionHrData, setSessionHrData] = useState<Record<string, SessionHrData | 'loading' | 'none'>>({});
```
with (the `SessionHrData` type is now imported; the state map value is `HrSessionState`):
```ts
  const [sessionHrData, setSessionHrData] = useState<Record<string, HrSessionState>>({});
```

- [ ] **Step 3: Rewrite `loadSessionHr`** (`app/health/health-content.tsx:499-513`). Replace:
```ts
  const loadSessionHr = useCallback(async (workoutSessionId: string) => {
    if (sessionHrData[workoutSessionId]) return;
    setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'loading' }));
    try {
      const res = await fetch(`/api/oura/hr-data?sessionId=${workoutSessionId}`);
      const data = await res.json() as { ready?: boolean; hasData?: boolean; startedAt?: string; readings?: { timestamp: string; bpm: number }[]; setStats?: { exerciseName: string; setNumber: number; loggedAt: string | null; hrr1: number | null; adequate: boolean | null }[] };
      if (data.ready && data.hasData && data.readings) {
        setSessionHrData(prev => ({ ...prev, [workoutSessionId]: data as SessionHrData }));
      } else {
        setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'none' }));
      }
    } catch {
      setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'none' }));
    }
  }, [sessionHrData]);
```
with:
```ts
  const loadSessionHr = useCallback(async (workoutSessionId: string) => {
    const existing = sessionHrData[workoutSessionId];
    // Skip if a load is in flight or we already have real data; retry on the
    // empty sentinels ('none'/'incomplete') so a later expand re-pulls once the
    // background sync has landed (acceptance: renders on second expand at latest).
    if (existing === 'loading') return;
    if (existing && existing !== 'none' && existing !== 'incomplete') return;
    setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'loading' }));
    try {
      // Re-pull Oura HR for this session's window before reading (mirrors the
      // Done screen, done-screen.tsx:98-103). Fire it and ignore transport
      // errors — the route itself is fail-soft and returns { success, readings }.
      await fetch('/api/oura/hr-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workoutSessionId }),
      }).catch(() => {});
      const res = await fetch(`/api/oura/hr-data?sessionId=${workoutSessionId}`);
      const data = await res.json() as HrDataResponse;
      setSessionHrData(prev => ({ ...prev, [workoutSessionId]: classifyHrResponse(data) }));
    } catch {
      setSessionHrData(prev => ({ ...prev, [workoutSessionId]: 'none' }));
    }
  }, [sessionHrData]);
```

- [ ] **Step 4: Render the distinct not-completed message and exclude `'incomplete'` from the data guard** (`app/health/health-content.tsx:933-934`). Replace:
```tsx
                              {hrState === 'none' && <p className="text-[10px] text-muted-foreground">No HR data — ensure Oura was worn and synced</p>}
                              {hrState && hrState !== 'loading' && hrState !== 'none' && (hrState as SessionHrData).hasData && (
```
with:
```tsx
                              {(hrState === 'none' || hrState === 'incomplete') && <p className="text-[10px] text-muted-foreground">{hrEmptyMessage(hrState)}</p>}
                              {hrState && hrState !== 'loading' && hrState !== 'none' && hrState !== 'incomplete' && (hrState as SessionHrData).hasData && (
```

- [ ] **Step 5: Typecheck + lint.** Run: `pnpm tsc --noEmit && pnpm lint`. Both must pass (the removed local `SessionHrData` is now the imported type; the `(hrState as SessionHrData)` casts at `:934-942` still resolve to the imported interface).

- [ ] **Step 6: Dev-server verification** (no unit surface for a UI wiring change). Start `pnpm dev` (local seeded DB). Then:
  1. Open `/health`, tap a calendar day that has a logged workout, and expand the session card.
  2. Confirm the HR Recovery block shows the pulse skeleton, then — since the sandbox has no Oura token — falls to the **"No HR data — ensure Oura was worn and synced"** copy (state `'none'`), and the sheet does **not** crash.
  3. In the Network tab / server log confirm a `POST /api/oura/hr-sync` fired on expand and returned `{ success: true, readings: 0 }` (fail-soft, no wedge), followed by the `GET /api/oura/hr-data`.
  4. Collapse and re-expand the same card: confirm `loadSessionHr` runs again (skeleton reappears) — i.e. the `'none'` sentinel is retried, not cached-and-stuck.
  5. Not-completed path: pick (or temporarily seed) a `workout_sessions` row with `completed_at IS NULL` for the test user, expand its card, and confirm the block shows **"This workout wasn't marked complete, so there's no HR recovery to show"** (state `'incomplete'`) and that `GET /api/oura/hr-data` returned `{ ready: false }`.
  - Record which surfaces were exercised vs. not (see Task 3 caveat).

- [ ] **Step 7: Commit** — `git add app/health/health-content.tsx && git commit -m "Re-pull Oura HR when expanding a past workout in the calendar sheet"`

---

### Task 3: Verify timezone-window integrity, rate-limit parity, and acceptance criteria

No code — a confirmation gate that closes the secondary-hardening items from the U2 spec and records the end-to-end caveat.

**Files:** none (verification only).

- [ ] **Step 1: Confirm the ±10-min window join is not losing readings to timezone skew.** Read and cite:
  - `lib/data/postgres/slices/oura.ts:342-352` — `getHrForWindow` filters `timestamp >= from AND timestamp <= to`.
  - `lib/data/postgres/schema.ts:644` — `oura_heartrate.timestamp` is `timestamp(..., { withTimezone: true })` (timestamptz).
  - `lib/data/postgres/schema.ts:148-149` — `workout_sessions.startedAt`/`completedAt` are timestamptz.
  - `lib/oura/hr-sync.ts:24-28` — readings are stored via `new Date(r.timestamp)` where `r.timestamp` is Oura's ISO-8601-with-offset string → a correct absolute instant.
  - `app/api/oura/hr-data/route.ts:19-20` — `from`/`to` are built from `ws.startedAt`/`ws.completedAt` (`Date`), i.e. absolute instants.
  **Expected conclusion:** every value on both sides of the comparison is an absolute UTC instant (timestamptz compares by instant, not wall-clock), so the ±10-min window is **not** subject to timezone skew — **no code change required.** Record this conclusion in the PR description. If any of the cited columns is found to be a naive `timestamp` (no `withTimezone`), stop and escalate — that would change the analysis.

- [ ] **Step 2: Confirm rate-limit parity.** `loadSessionHr` reuses the **existing** `POST /api/oura/hr-sync` route — no new route is introduced. Confirm (grep) that no route under `app/api/oura/` carries a rate limiter today, so "match siblings" means none is added. Record: no rate limit added; matches all Oura sibling routes.

- [ ] **Step 3: Full check suite.** Run: `pnpm test && pnpm tsc --noEmit && pnpm lint && pnpm build`. All green.

- [ ] **Step 4: Acceptance criteria (spec entry #9 / addendum).**
  - [ ] Expanding a past workout triggers a sync (`POST /api/oura/hr-sync` fires on expand).
  - [ ] The HR chart renders on the second expand at latest (empty sentinels are retried, not cached-and-stuck).
  - [ ] A `completedAt == null` session shows a **distinct** message ("This workout wasn't marked complete…"), **not** "ensure Oura was worn and synced".
  - [ ] No wedge/crash when the sync returns 0 readings or errors (fail-soft `.catch(() => {})` + try/catch → `'none'`).
  - [ ] Timezone-window integrity confirmed (Step 1); rate-limit parity confirmed (Step 2).

- [ ] **Step 5: ⚠️ Record the end-to-end caveat.** In the PR description note: **needs real Oura data to fully verify end-to-end (the sandbox has no Oura token, so `hr-sync` returns 0 readings and the chart-populated path cannot be observed locally).** The instant-hydration path (ring worn → sync pulls readings → chart renders on second expand) must be verified on the S25 APK against a real token per `docs/device-smoke-checklist.md`. Locally verifiable: the `'none'` and `'incomplete'` message branches, the POST-then-GET ordering, and the retry-on-re-expand behaviour (Task 2 Step 6).
