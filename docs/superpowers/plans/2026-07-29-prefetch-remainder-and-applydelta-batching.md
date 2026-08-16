# Plan — the two undocumented performance gaps (2026-07-29)

Both were found while auditing what the Q-1 "native feel" track does *not* already cover. Neither
had a backlog entry. They are independent; either can ship without the other.

---

## Gap 1 — 17 of 21 navigation call sites still tap cold

### The defect

`<Link>` prefetches its destination on viewport entry. A `<button onClick={() => router.push(href)}>`
gets nothing, so the destination's RSC payload fetch starts at tap time — with the view transition
already holding the outgoing screen frozen, waiting on exactly that fetch.

This was proven in #919 (measured: destination ready at 51 ms, screen frozen to 184 ms) and fixed for
the four Home score circles plus the three Health-screen surfaces pushing the same routes. The
journal recorded that *all 21* `useTransitionRouter` call sites are buttons but filed nothing about
the remaining 17 — an orphaned finding under the standing "No orphaned findings" rule.

### Which of the 17 actually warrant a prefetch

Prefetching is not free: each one is an RSC payload fetch. Warm a destination only where it is
**static or cheaply derivable** *and* the control is a **likely primary action**. Auditing all 17:

| site | pushes | prefetch? |
|---|---|---|
| `session-select-content` | `/workout?session=<id>` (recommended), `/stats` | **yes** — the app's primary daily action |
| `workout-select-content` | `/workout?session=<id>`, `/cardio` | **yes** — same action, second entry point |
| `modality-picker` | `/running`, `/activity/guided-walk` | **yes** — both static, picker is the whole screen |
| `time-picker-sheet` | `/running` or `/activity/guided-walk` by modality | **yes** — warm the one matching current modality |
| `log-activity-sheet` | `/activity`, `/activity/guided-walk` | **yes** — sheet mounts only when opened, so it is timely |
| `walk-summary` | `/activity` | **yes** — the Done button is the only exit |
| `running-plan-content` | `/activity` | **yes** — single static target |
| `profile-tab` | `/year-review`, `/admin` | no — rare, and `/year-review` is heavy |
| `ai-prescription-card` | `/config?new=program` | no — rare |
| `admin-content` | three `/admin/*` routes | no — admin-only, never a hot path |
| `pre-workout-screen`, `pre-activity-screen`, `year-review-content`, `session-explain-content`, `session-explain-empty`, `health/timeline`, `profile/[userId]` | **`.back()` only, no push** | n/a — nothing to warm |

So the real remainder is **7 sites**, not 17: seven use the router only for `back()`, and three are
deliberately declined.

**Do not prefetch every session in the tab list.** `session-select` renders the full active-session
set; warming all of them is N RSC fetches for one tap. Warm the recommended session only.

### Verification

Re-run the #919 harness (Chromium 412×915, CDP-throttled to 150 ms RTT) on one converted flow and
confirm time-to-motion tracks route commit rather than sitting on the cap. Prefetch correctness
itself is observable as the absence of an RSC request at tap time in the network log.

---

## Gap 2 — `applyDelta` crosses the Capacitor bridge once per row

### The defect

`runSQL` (`lib/sqlite/sqlite-service.ts:134`) is one `_db.run()` per statement — one JS↔native
bridge crossing each. `applyDeltaBody` (`lib/local-store/sqlite-backend.ts:1186`) awaits one per row,
across ~20 domains:

```ts
for (const r of delta.bodyMetrics ?? []) {
  if (r.deletedAt) await runSQL(`DELETE FROM body_metrics WHERE …`, [r.date])
  else             await runSQL(`INSERT INTO body_metrics … ON CONFLICT …`, [...])
}
```

A pull is therefore O(total rows) **sequential** bridge round-trips. The bridge is not cheap: the
owner's 2026-07-29 device profile put `androidBridge.onmessage` at 18.1% total and the bridge's own
logging at 16.4% self time. This is the same shape as #906 (`getWorkoutHistory` ~121 queries → 3),
on the write path instead of the read path.

`@capacitor-community/sqlite` exposes `executeSet(set, transaction?)` for batched parameterised
writes (`definitions.d.ts:182`). It is used **nowhere** in the repo.

### Scope — where this actually matters

Steady-state daily deltas are a handful of rows; batching them changes nothing perceptible. The cost
lands on **initial sync after install** and **restore-from-cloud**, where the delta is the full
history — realistically thousands of `set_logs` and `food_logs` rows, i.e. thousands of sequential
crossings. Frame the work as "restore/first-sync is slow", not "the app is slow".

**Measure before building.** Instrument one real pull and count rows per domain. If a restore is a
few hundred rows the priority drops sharply; if it is five figures this is the largest single
remaining win outside Phase 3.

### Design constraints (these are what make it non-trivial)

1. **Order must be preserved.** Dependent rows (session → exercise log → set log) are applied in
   sequence today. `executeSet` preserves array order; batch **within** a domain, and keep domain
   order unchanged. Do not reorder to group statements.
2. **Do not lose the failing-statement diagnostic.** `runSQL` deliberately re-throws naming the
   statement, with a comment explaining why: the plugin's bare "no current transaction" hides *which*
   write failed inside a large `applyDelta`. A naive `executeSet` reports the batch, not the row.
   **Mitigation:** on batch failure, replay that batch row-by-row through `runSQL` to surface the
   exact offending statement, then re-throw. The slow path only runs when something is already broken.
3. **Transaction interaction.** `applyDelta` already runs inside `beginTransaction`/`commitTransaction`
   and `runSQL` passes `!_inTransaction` as `_db.run`'s transaction flag. `executeSet` must be called
   with `transaction: false` for the same reason — it must not open a nested transaction.
4. **`sync_status` gating is unchanged.** Batching must not touch the `sync_status === 'synced'`
   guards; a pull must still never clobber a pending local edit.

### Suggested shape

Add to `lib/sqlite/sqlite-service.ts`:

```ts
export async function runSQLBatch(set: { statement: string; values: unknown[] }[]): Promise<void>
```

…which no-ops on empty, calls `_db.executeSet(set, false)`, and on error replays via `runSQL` to
name the offending statement before re-throwing. Then convert each `applyDelta` domain loop from
*execute-per-row* to *collect-then-flush*, one domain per commit so a regression bisects cleanly.

### Verification

`lib/local-store/__tests__/sqlite-backend.test.ts` already mocks `runSQL`/`querySQL` and asserts on
issued SQL, so the refactor is checkable **statement-for-statement**: capture the statement sequence
before and after and assert equality. That is a real equivalence proof, not a smoke test.

**It is not a device proof.** Native SQLite does not run in the web/dev sandbox — `getLocalStore`
returns null there — so `executeSet`'s actual parameter binding and transaction behaviour cannot be
exercised in-session at all. Under the Canonical Runtime gate this needs either the on-device smoke
run or an explicit Known-Issues row marking it device-unverified. Given this is the code path with
the worst data-loss history in the repo, prefer the device run.

---

## Sequencing

Gap 1 first — it is small, fully verifiable in-session, and closes an orphaned finding from a PR that
already shipped. Gap 2 needs its row-count measurement before it can be priced, and wants a device
before it merges.
