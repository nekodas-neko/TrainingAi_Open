# Calendar Day-Detail Whole-Session Edit/Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a session-level edit and delete affordance (delete gated by a reusable `ConfirmDialog`) to each workout-session card in the Health calendar day-detail sheet, backed by a new whole-session delete endpoint that cascades to its exercise/set logs and keeps periodization counters honest.

**Architecture:** The day-detail sheet (`app/health/health-content.tsx`) renders one collapsible card per session (`:887-907` header, expand/collapse only). It already reads day data server-only via `GET /api/day-log` and mutates per-exercise via bare `fetch('/api/workout-entry')` (PATCH/DELETE) — **not** through the local store/outbox. We mirror that established server-only sibling pattern: a shared `deleteWorkoutSession(userId, workoutSessionId)` function (raw `getPool()` SQL, `user_id`-scoped, cascade via FK), a new `DELETE /api/workout-sessions` route that calls it, and UI wiring that reuses the existing `ConfirmDialog` primitive. "Edit" resolves to a clearer entry point that expands the card, surfacing the existing per-exercise pencil/trash controls (no new full-session editor exists in the codebase).

**Tech Stack:** Next.js 15 App Router route handlers, `pg` Pool (`getPool()`), PostgreSQL FK cascade (`exercise_logs`/`set_logs` `ON DELETE CASCADE`), React 19 client component, shadcn `ConfirmDialog`, Lucide icons, vitest.

---

## Key findings from investigation (read before starting)

1. **No whole-session delete endpoint exists.** `DELETE /api/workout-entry` (`app/api/workout-entry/route.ts:94-175`) deletes a single `exercise_log` and only cascades to a session delete *when it was the session's last exercise* (`:128-160`). Its counter-decrement + PR-reconcile logic is the template for the new endpoint.
2. **The calendar edit/delete path is server-only, NOT offline-first.** `handleEditSave`/`handleDelete`/`handleDeleteActivity` (`app/health/health-content.tsx:520-577`) call bare `fetch('/api/workout-entry' | '/api/activity-logs')`. The sheet reads day data from `GET /api/day-log` (`:486`), not the local store. So the whole-session delete follows the same server-only shape as its sibling controls.
3. **Workout-session deletes do NOT propagate cross-device today.** `workout_sessions` has **no** `deleted_at`/tombstone column (`lib/data/postgres/schema.ts:143-160`). `getSyncDelta` (`lib/data/postgres/adapter.ts:2618-2620`) pulls only rows with `updated_at > since`; a hard-deleted row simply vanishes from the server and `applyDelta`'s `workout_log` branch (`lib/local-store/sync-engine.ts:529-533`) only marks-synced — it has **no delete signal**. The `pushMutations` `workout_log` branch (`lib/data/postgres/adapter.ts:3068-3078`) only *logs* (via `logExerciseFromPayload`); there is no delete branch. **We do not add tombstone infrastructure here** — that is owned by backlog **queue item 1 (offline-sync integrity)**. See the ⚠️ caveat in the final task.
4. **`ConfirmDialog` exists** (`components/ui/confirm-dialog.tsx`, `variant="destructive"`). The per-exercise confirm hand-rolls a raw `<Dialog>` (`app/health/health-content.tsx:826-835`) — the new session-delete confirm **reuses `ConfirmDialog`** per the spec.
5. **Counter reconcile:** deleting a completed session must decrement `session_periodization.sessions_in_phase`, mirroring `workout-entry` DELETE (`:151-158`) — guarded by `started_at >= phase_started_at`, floored at 0. Distinct exercise names in the session are collected pre-delete so `reconcilePersonalRecord` runs per exercise afterward.

---

### Task 1: Shared `deleteWorkoutSession` function (server logic) — TDD

**Files:**
- Create: `lib/workout/delete-session.ts`
- Test: `lib/workout/__tests__/delete-session.test.ts`

- [ ] Write the test FIRST. It mocks `@/lib/data/postgres/client` (`getPool`) with a recording fake client and asserts: (a) ownership check is scoped to `user_id`; (b) the `DELETE FROM workout_sessions` is scoped to both `id` AND `user_id`; (c) the counter decrement runs with the phase-window guard; (d) the function returns the distinct exercise names for PR reconcile; (e) a session not owned by the user returns `{ deleted: false }` and issues no DELETE.

```ts
// lib/workout/__tests__/delete-session.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface RecordedQuery { text: string; params: unknown[] }

function makeClient(rows: Record<string, unknown[]>) {
  const queries: RecordedQuery[] = []
  const client = {
    query: vi.fn(async (text: string, params: unknown[] = []) => {
      queries.push({ text, params })
      // Route canned result sets by a substring of the SQL.
      if (text.includes('SELECT 1 FROM workout_sessions')) return { rows: rows.ownership ?? [] }
      if (text.includes('SELECT DISTINCT el.exercise_name')) return { rows: rows.names ?? [] }
      if (text.includes('SELECT session_id, started_at')) return { rows: rows.session ?? [] }
      return { rows: [] }
    }),
    release: vi.fn(),
  }
  return { client, queries }
}

const { getPoolMock, connectMock } = vi.hoisted(() => {
  const connectMock = vi.fn()
  return { connectMock, getPoolMock: vi.fn(() => ({ connect: connectMock })) }
})
vi.mock('@/lib/data/postgres/client', () => ({ getPool: getPoolMock }))

import { deleteWorkoutSession } from '@/lib/workout/delete-session'

describe('deleteWorkoutSession', () => {
  beforeEach(() => { getPoolMock.mockClear(); connectMock.mockReset() })

  it('deletes a user-owned session, scoped to user_id, and returns exercise names', async () => {
    const { client, queries } = makeClient({
      ownership: [{ ok: 1 }],
      names: [{ exercise_name: 'Squat' }, { exercise_name: 'Bench Press' }],
      session: [{ session_id: 'ps-1', started_at: new Date('2026-07-01T08:00:00Z') }],
    })
    connectMock.mockResolvedValue(client)

    const result = await deleteWorkoutSession('user-1', 'ws-1')

    expect(result).toEqual({ deleted: true, exerciseNames: ['Squat', 'Bench Press'] })

    const ownership = queries.find(q => q.text.includes('SELECT 1 FROM workout_sessions'))!
    expect(ownership.params).toEqual(['ws-1', 'user-1'])

    const del = queries.find(q => q.text.includes('DELETE FROM workout_sessions'))!
    expect(del.text).toContain('user_id = $2')
    expect(del.params).toEqual(['ws-1', 'user-1'])

    const counter = queries.find(q => q.text.includes('session_periodization'))!
    expect(counter.text).toContain('sessions_in_phase - 1')
    expect(counter.text).toContain('>= phase_started_at')
    expect(counter.params[0]).toBe('user-1')

    expect(queries.some(q => q.text.includes('BEGIN'))).toBe(true)
    expect(queries.some(q => q.text.includes('COMMIT'))).toBe(true)
    expect(client.release).toHaveBeenCalled()
  })

  it('returns { deleted: false } and issues no DELETE when the session is not owned', async () => {
    const { client, queries } = makeClient({ ownership: [] })
    connectMock.mockResolvedValue(client)

    const result = await deleteWorkoutSession('user-1', 'ws-not-mine')

    expect(result).toEqual({ deleted: false, exerciseNames: [] })
    expect(queries.some(q => q.text.includes('DELETE FROM workout_sessions'))).toBe(false)
    expect(client.release).toHaveBeenCalled()
  })
})
```

- [ ] Implement `lib/workout/delete-session.ts` to pass the test. Ownership check first (fail-closed: no row → `{ deleted: false }`). Collect distinct exercise names before deleting. Capture `session_id` + `started_at` for the counter decrement. Delete `workout_sessions` scoped to `id` AND `user_id` — `exercise_logs` and `set_logs` cascade via FK (`ON DELETE CASCADE`), so no manual child deletes (never delete-and-reinsert FK'd rows). Decrement `sessions_in_phase` guarded by the phase window, floored at 0.

```ts
// lib/workout/delete-session.ts
import { getPool } from '@/lib/data/postgres/client'

/**
 * Hard-deletes a whole workout session and (via ON DELETE CASCADE) its
 * exercise_logs + set_logs, scoped to the owning user. Returns the distinct
 * exercise names so callers can reconcile personal records afterward.
 *
 * Server-only path (mirrors DELETE /api/workout-entry). Cross-device delete
 * propagation is intentionally out of scope — see queue item 1 (offline-sync
 * integrity / delete tombstones); workout_sessions has no deleted_at today.
 */
export async function deleteWorkoutSession(
  userId: string,
  workoutSessionId: string,
): Promise<{ deleted: boolean; exerciseNames: string[] }> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')

    const { rows: owned } = await client.query(
      `SELECT 1 FROM workout_sessions WHERE id = $1 AND user_id = $2`,
      [workoutSessionId, userId],
    )
    if (owned.length === 0) {
      await client.query('ROLLBACK')
      return { deleted: false, exerciseNames: [] }
    }

    const { rows: nameRows } = await client.query<{ exercise_name: string }>(
      `SELECT DISTINCT el.exercise_name
       FROM exercise_logs el
       WHERE el.workout_session_id = $1`,
      [workoutSessionId],
    )
    const exerciseNames = nameRows.map(r => r.exercise_name)

    // Capture program-session + start time before delete to keep the
    // AI-periodization phase counter honest (mirrors workout-entry DELETE).
    const { rows: sessRows } = await client.query<{ session_id: string | null; started_at: Date }>(
      `SELECT session_id, started_at FROM workout_sessions WHERE id = $1 AND user_id = $2`,
      [workoutSessionId, userId],
    )
    const programSessionId = sessRows[0]?.session_id ?? null
    const startedAt = sessRows[0]?.started_at ?? null

    // exercise_logs + set_logs cascade via FK ON DELETE CASCADE.
    await client.query(
      `DELETE FROM workout_sessions WHERE id = $1 AND user_id = $2`,
      [workoutSessionId, userId],
    )

    // Completing a session increments sessions_in_phase, so deleting one must
    // decrement it — but only when the deleted session fell inside the current
    // phase window (started_at >= phase_started_at). Floor at 0.
    if (programSessionId && startedAt) {
      await client.query(
        `UPDATE session_periodization
         SET sessions_in_phase = GREATEST(sessions_in_phase - 1, 0), updated_at = now()
         WHERE user_id = $1 AND program_session_id = $2 AND $3 >= phase_started_at`,
        [userId, programSessionId, startedAt],
      )
    }

    await client.query('COMMIT')
    return { deleted: true, exerciseNames }
  } catch (e) {
    await client.query('ROLLBACK')
    throw e
  } finally {
    client.release()
  }
}
```

- [ ] Run `pnpm test lib/workout/__tests__/delete-session.test.ts` — both cases green.

---

### Task 2: `DELETE /api/workout-sessions` route

**Files:**
- Create: `app/api/workout-sessions/route.ts`
- Reference: `app/api/workout-entry/route.ts:94-175` (auth + PR-reconcile pattern)

Note: `app/api/workout-sessions/day/route.ts` and `.../rpe/route.ts` already exist; adding a top-level `route.ts` under the same segment is valid (they are distinct sub-routes).

- [ ] Create the route. Auth → parse body → call `deleteWorkoutSession` → 404 if `deleted === false` → reconcile PRs for each returned exercise name → return `{ success: true }`. Fail-closed on missing `workoutSessionId`.

```ts
// app/api/workout-sessions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getRepository } from "@/lib/data";
import { deleteWorkoutSession } from "@/lib/workout/delete-session";

// DELETE — remove a whole workout session and its exercise/set logs (cascade).
export async function DELETE(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { workoutSessionId: string };
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { workoutSessionId } = body;
  if (!workoutSessionId) {
    return NextResponse.json({ error: "Missing workoutSessionId" }, { status: 400 });
  }

  try {
    const { deleted, exerciseNames } = await deleteWorkoutSession(userId, workoutSessionId);
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const repo = await getRepository();
    for (const name of exerciseNames) {
      await repo.reconcilePersonalRecord(userId, name);
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('[workout-sessions DELETE]', e);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
```

- [ ] `pnpm tsc --noEmit` clean.

---

### Task 3: UI — session-level edit/delete controls + reused `ConfirmDialog`

**Files:**
- Modify: `app/health/health-content.tsx` (state `:161-166`; handlers near `:537-559`; session header `:887-907`; dialogs block `:826-846`; imports `:28,:31,:33`)

- [ ] Add the `ConfirmDialog` import alongside the existing `Dialog` import (line 33 region).

```tsx
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
```

- [ ] Add session-delete state next to the existing `deleteEx`/`deleteActivity` state (after `app/health/health-content.tsx:163`). The value carries the session id and its display name for the confirm message.

```tsx
  const [deleteSession, setDeleteSession] = useState<{ id: string; name: string } | null>(null);
```

- [ ] Add `handleDeleteSession` immediately after `handleDelete` (after `app/health/health-content.tsx:559`). It mirrors `handleDelete`: server-only `fetch`, toast, invalidate derived workout summaries, refresh the overlay. `mutating` reuse and dependency array match the sibling.

```tsx
  const handleDeleteSession = useCallback(async () => {
    if (!deleteSession || !dayOverlay) return;
    setMutating(true);
    try {
      const res = await fetch("/api/workout-sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workoutSessionId: deleteSession.id }),
      });
      if (!res.ok) throw new Error();
      toast.success("Session deleted");
      setDeleteSession(null);
      // Deleting a whole session shifts phase counters, training load, timeline
      // and history counts — clear derived caches so they don't serve stale
      // totals for 30 min. refreshDayOverlay reads /api/day-log directly.
      invalidateWorkoutSummaries().catch(() => {});
      refreshDayOverlay(dayOverlay.date);
    } catch { toast.error("Failed to delete session"); }
    finally { setMutating(false); }
  }, [deleteSession, dayOverlay, refreshDayOverlay]);
```

- [ ] Replace the session-header `<button>` (`app/health/health-content.tsx:887-907`) so the header is a tappable expand region with edit + delete controls on the right. Per the Android WebView rule (no nested `<button>`), make the expand region a `<div role="button">` and keep the pencil/trash as real `<button>`s. "Edit" expands the card (revealing the existing per-exercise pencil/trash at `:921-926`) — the concrete meaning of session edit in this codebase.

```tsx
                        <div
                          role="button"
                          tabIndex={0}
                          className="w-full flex items-center justify-between px-4 py-3 text-left"
                          onClick={() => {
                            const expanding = !isExpanded;
                            setDayOverlay(prev => prev ? { ...prev, expanded: expanding ? expandKey : null } : prev);
                            if (expanding && workoutSessionId) loadSessionHr(workoutSessionId);
                          }}
                          onKeyDown={e => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              const expanding = !isExpanded;
                              setDayOverlay(prev => prev ? { ...prev, expanded: expanding ? expandKey : null } : prev);
                              if (expanding && workoutSessionId) loadSessionHr(workoutSessionId);
                            }
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <span className="text-lg">{palette.emoji}</span>
                            <div className="min-w-0">
                              <p className={cn("text-sm font-bold truncate", palette.textClass)}>{shortSessionName(sessionName)}</p>
                              {workoutDurations[sessionName] && (
                                <p className="text-xs text-muted-foreground tabular-nums">
                                  {workoutDurations[sessionName]!.start} → {workoutDurations[sessionName]!.end} · {workoutDurations[sessionName]!.minutes} min
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1 flex-none">
                            {workoutSessionId && (
                              <>
                                <button
                                  aria-label="Edit session"
                                  onClick={e => {
                                    e.stopPropagation();
                                    if (!isExpanded) {
                                      setDayOverlay(prev => prev ? { ...prev, expanded: expandKey } : prev);
                                      if (workoutSessionId) loadSessionHr(workoutSessionId);
                                    }
                                  }}
                                  className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                                >
                                  <PencilIcon className="h-4 w-4" />
                                </button>
                                <button
                                  aria-label="Delete session"
                                  onClick={e => {
                                    e.stopPropagation();
                                    setDeleteSession({ id: workoutSessionId, name: shortSessionName(sessionName) });
                                  }}
                                  className="rounded p-1.5 hover:bg-muted text-muted-foreground"
                                >
                                  <Trash2Icon className="h-4 w-4" />
                                </button>
                              </>
                            )}
                            <ChevronDownIcon className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded && "rotate-180")} />
                          </div>
                        </div>
```

- [ ] Add the `ConfirmDialog` for session delete next to the existing raw-`<Dialog>` confirms (after `app/health/health-content.tsx:846`). Reuse the primitive — do NOT hand-roll a `<Dialog>`.

```tsx
      <ConfirmDialog
        open={deleteSession !== null}
        onOpenChange={open => { if (!open) setDeleteSession(null); }}
        title="Delete session?"
        message={deleteSession ? `Remove the entire ${deleteSession.name} session and all its exercises? This cannot be undone.` : ""}
        confirmLabel={mutating ? "Deleting…" : "Delete"}
        variant="destructive"
        onConfirm={handleDeleteSession}
      />
```

- [ ] `pnpm tsc --noEmit`, `pnpm lint`, `pnpm build` all clean.

---

### Task 4: Verification, acceptance criteria & caveats

**Files:**
- Reference: `docs/device-smoke-checklist.md`

- [ ] **Unit tests** (`pnpm test`): `deleteWorkoutSession` deletes a user-owned session scoped to `user_id`, returns exercise names, and no-ops (no DELETE) for a session it doesn't own.
- [ ] **Dev-server verification** (`pnpm dev`, local seeded DB, log in as `test@local.dev` / `testpass123`):
  - Open Health → calendar → tap a day with a logged workout to open the day-detail sheet.
  - Confirm each session card shows an edit (pencil) and delete (trash) control in the header, plus the chevron.
  - Tapping the header body (or the pencil) expands the card; the pencil expands without collapsing; per-exercise pencil/trash still work.
  - Tapping the trash opens the `ConfirmDialog` (title "Delete session?", destructive confirm). **Cancel** dismisses it and the session remains. **Delete** removes the session from the overlay; a `GET /api/day-log` refetch shows it gone; toast "Session deleted".
  - Verify in the DB that the session's `exercise_logs` and `set_logs` are gone and `session_periodization.sessions_in_phase` decremented (not negative) for a completed in-phase session.
  - Attempt a delete for a session id owned by another user (craft a request) → 404, no rows removed (user-scoping).
- [ ] **Playwright** (optional if driving the flow): assert confirm appears on trash tap; confirming removes the card; cancel leaves it.

**Acceptance criteria:**
- Each session card in the day-detail sheet has a working session-level edit (expands card) and delete (opens confirm) control.
- Delete is gated by the reusable `ConfirmDialog` (`variant="destructive"`), not a hand-rolled dialog.
- Deleting a session removes it + its `exercise_logs` + `set_logs` (FK cascade), scoped to `user_id`, and reconciles PRs + decrements `sessions_in_phase` without drift.
- Lucide icons only; no nested native `<button>` in the tappable header; `pnpm test`/`tsc`/`lint`/`build` all green.

**⚠️ Failure surfaces NOT exercised (state these when presenting):**
- **Offline / cross-device delete propagation is out of scope and does NOT work.** This delete is server-only (mirrors the existing per-exercise `/api/workout-entry` sibling and the sheet's server-only reads). `workout_sessions` has no `deleted_at` tombstone and the sync pull has no delete signal, so a delete performed on one device will **not** propagate to another until an unrelated sync overwrites — and a delete issued while offline is not queued at all. **This inherits the existing limitation; it is not a regression.** Full offline/outbox + tombstone treatment for workout deletes belongs to **backlog queue item 1 (offline-sync integrity)** — do not duplicate that work here. Note this dependency in the PR description.
- **Native SQLite / Capacitor**, **safe-area insets**, and **Samsung WebView rendering** of the new header controls are not verifiable in the web sandbox — run `docs/device-smoke-checklist.md` on the S25 before calling it done.
- **Drifted prod periodization counters**: the decrement is idempotent-ish but a prod `sessions_in_phase` already drifted from historical bugs won't self-correct from this path alone (reconcile-on-read owns that).
