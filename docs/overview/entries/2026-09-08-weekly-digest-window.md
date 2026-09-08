## 2026-09-08 — The recap week, pinned to the week that actually ended (PS-39)

**Branch:** `test/weekly-digest-window` · **Lane A**

### What shipped

9 tests on `POST /api/weekly-digest`; `BASELINE` **132 → 131**. Eight of the twelve
believed-tested-and-not routes now have real tests.

### The window is the whole route

`weekly-digest` recaps the last **completed** Monday–Sunday week, not "this week so far", and the
route's comment says why: on a Monday morning the in-progress week is near-empty and reads as a
**misleading ~100% drop** against the prior full week. Everything else — the volume comparison, the
cache key, the 14-day read — hangs off that boundary, and a date window is this repo's most-broken
class.

Pinned with a frozen clock so the boundaries are computed rather than guessed:

- On **Monday 2026-09-07**, `weekStart` is **2026-08-31** — the week that just ended, not the one
  just begun. Mutation-checked by recapping the current week instead: **four cases fail**.
- The read reaches back a full **14 days** (`2026-08-24` from a Thursday in the recap week), so the
  comparison is full-week against full-week rather than a partial against a whole.
- A zero prior week says **"first week of data"** rather than dividing by it — no `Infinity%`.
- Two real weeks compare as **`+50% vs the week before`**.

**These run in `America/New_York`, not Brisbane.** In the default zone a window assertion passes
against a route that hardcodes `DEFAULT_TZ` and proves nothing — the vacuous shape a mutation check
caught earlier in this PS-39 run. Hardcoding `DEFAULT_TZ` here fails the 14-day case.

### Q-293, again

The cache is keyed on a hash of the assembled context, not on the week. The recap week is closed so
its inputs mostly are too — but a late ring back-fill or a corrected weigh-in still changes them, and
keying on the week alone served the first digest written for it for the rest of the week with no way
to notice. Pinned by changing an input and requiring the key to change; mutation-checked by keying on
`isoWeekKey`.

Also pinned: a fresh cached digest is served **without calling the model**, `force` bypasses it, a
model failure is a **502 that does not leak the error**, and an oversized body is a 413 while an
absent one is fine (the body is optional).

### One mock mistake worth recording

`vi.mock` is hoisted above the file's `const` declarations, so building the repository object **in
the factory body** is a TDZ error — `Cannot access 'getWorkoutSessionsFrom' before initialization`.
It has to be built inside the returned async function, which runs later. The other route tests in
this run happened to be written that way already; this is the first that wasn't.

### Verification

- `pnpm check:rules` — **Ran 70 of 70**. `tsc --noEmit` clean, `check-test-typecheck` at baseline,
  `pnpm build` exit 0, full suite green.
- **Mutation-checked three ways**: recapping the current week fails 4 cases, hardcoding `DEFAULT_TZ`
  fails the 14-day case, keying the cache on the week alone fails the Q-293 case.

**Not exercised:** the model is stubbed and every repository read returns an empty set except where a
case seeds one, so what is pinned is the window arithmetic, the cache contract and the failure path —
not the digest's content or the many signal lines that go into its prompt.

**Four of the twelve remain**: `workout-data` (600 lines), `nutrition-goals/recommend` (363),
`workout-review/session/[sessionId]`, `ai-periodization/session/[sessionId]/prescribe`.

No version bump: tests only.
