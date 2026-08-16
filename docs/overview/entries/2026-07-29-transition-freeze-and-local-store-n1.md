## 2026-07-29 — Fix the transition freeze, crossfade tab switches, and kill the local-store N+1

Three changes from owner feedback after #894 shipped: *"I mostly see a 1-2s delay when transitioning
pages this way. Not very fast/swift feel."* Plus a request for tab transitions.

### 1. The route transition was making a slow navigation look worse

`lib/view-transition.ts` held the outgoing screen frozen until the incoming route rendered, with a
**1000 ms** cap. A view transition freezes the page while its callback is pending, so on a route
taking a second to render the owner watched a still frame for that whole second and *then* got a
slide.

**The delay already existed** — #894 didn't make navigation slower. It converted an invisible wait
(old screen stays live and interactive) into a visible freeze, which reads as slower. That was a bad
trade and the wrong model of a native push: a native push slides **immediately** and lets the
incoming screen fill in behind the animation; it does not wait for content.

Cap cut to **150 ms**. A fast route still settles first, so the transition captures real content; a
slow one slides to whatever has rendered and fills in behind. Neither reads as a stall.

### 2. Tab switches now crossfade

`components/shell/tab-shell.tsx` + `app/globals.css`: a 120 ms opacity fade on the incoming panel.

This reverses the position taken in #894, which left tabs instant on the grounds that an iOS tab bar
doesn't animate. That was reasoning from convention over the owner's actual request. It is also the
*better* place for animation: every tab panel is already mounted, so a tab swap costs no network and
no re-render — the fade animates content that is already painted. That is exactly why it reads as
polish, where the route transition read as waiting.

Opacity-only and 120 ms: one compositor property, no layout, no paint. Still a fade rather than a
slide — tabs are peers, and lateral motion implies a depth relationship that doesn't exist.

### 3. `getWorkoutHistory` was 1 + N + (N×M) queries

`lib/local-store/sqlite-backend.ts` read sessions, then **one query per session** for its exercise
logs, then **one query per exercise log** for its sets. Twenty sessions of five exercises is ~121
queries, each crossing the Capacitor JS↔native bridge. It is called from **five** places — the home
screen, Health, the exercise-history sheet, the exercise-summary screen, and the **active workout
screen** — all on the hot path, all with a 90-day cutoff.

This is the source of the `CapacitorSQLite.query` burst visible in the owner's console capture, first
noted during Phase 0 and left unqueued because it was unquantified.

Now three queries total: sessions, all their exercise logs in one `IN()`, all those logs' sets in one
`IN()`, grouped in memory. **Constant in history size.** The `IN()` lists are chunked at 400 ids via
a `queryByIds` helper, because SQLite caps host parameters per statement (commonly 999) and the list
length is a function of how much the user trains — a 90-day window is ~325 exercise logs today, which
is under the cap but not by a margin worth trusting.

### Tests

Five new cases in `lib/local-store/__tests__/sqlite-backend.test.ts` covering the query count, the
grouping (sets under their log, logs under their session), a log with no sets, a session with no
logs, the empty-history short-circuit, and the chunking.

**These were checked against the old implementation, not just the new one:** reverting
`sqlite-backend.ts` to `main` makes **3 of the 5 fail**. A test that passes both ways proves nothing,
and this file's whole value is catching a regression in a data path the sandbox cannot execute.

Full local-store suite: 72 passing. `pnpm tsc --noEmit` clean, `pnpm lint` 0 errors.

### Not verified

- **On device.** The local store is native-SQLite only (`getLocalStore` returns null in the web
  sandbox), so the query-count win is proven by unit test, not observed on the S25. The grouping
  behaviour is locked by tests; the *speed* is inferred from removing ~118 bridge crossings.
- **How the 150 ms cap and the crossfade feel** on the Samsung WebView. Both degrade safely — an
  unsupported browser or reduced-motion preference falls through to the current instant behaviour.
- **Why a non-tab route took 1–2 s in the first place.** The freeze fix hides it; it does not explain
  it. If routes still feel slow after this, the N+1 fix above is the most likely cause and the next
  thing to measure — `active-workout-screen` and `exercise-history-sheet` are both slow routes *and*
  `getWorkoutHistory` callers.
