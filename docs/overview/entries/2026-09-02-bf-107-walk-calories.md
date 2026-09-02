# 2026-09-02 — the walk summary shows its calories (BF-107)

**Lane B · branch `fix/bf-107-walk-calories` · v1.434.0**

*"the final screen doesnt show calories burned."* The walk summary rendered three tiles — Duration,
Avg HR, Max HR — and no energy, on a screen that already carries per-interval cadence, a heart-rate
chart, time in zone and Session Load.

## The number was already reaching the client

`POST /api/activity-logs` answers `{ activityLog }` with the derived calories on it. The web branch
checked `res.ok` and threw the body away.

The value is computed server-side and cannot move: `estWorkoutKcal`'s MET table is read through
`node:path`, so it cannot be imported into a client bundle. That is why the client sends
`caloriesBurned: null` and why the figure exists only *after* this screen has painted.

## The device path needed more, and that is the half that matters

The entry noted it in passing and it turns out to be the whole fix on the canonical runtime:
`pushMutations` only flips the row to `synced` — **the derived value lands on a pull.** So the fix
forces one (`pullDelta(userId, true)`) inside `pushThenRevalidate`'s callback and reads the row back.

**Without that the tile is a dash forever on the device**, which is the reported bug left unfixed
while looking fixed. It stays inside the callback rather than replacing it, because that callback runs
only when something was actually pushed, and because revalidating *around* a local write rather than
after it is its own bug class with a CI rule attached.

Until either path lands, the tile reads `—`. Never `0`: a zero is a claim about a walk that burned
nothing, and offline that is the only state the tile ever reaches.

## The sibling claim in the entry was wrong

It said `done-activity-screen.tsx` takes the same write path and has the same gap, to be fixed in the
same PR. It does take the same write path — but it **navigates away the instant it saves**
(`router.push('/workout-select')` at lines 264 and 310), so its stat grid is a *pre-save draft
summary*. A calories tile there would render `—` and then the screen would vanish.

Checked rather than assumed, and recorded on the entry so the next reader does not add a dead tile.

## One tile, one primitive

The stat markup existed twice and had **already drifted** — `rounded-2xl` in the walk summary against
`rounded-xl` in the sibling — which is the drift a shared primitive exists to stop. It is
`components/ui/stat-tile.tsx` now. The sibling's inline copies are left: converting them is a pure
refactor of a file whose behaviour this entry does not change, and it is recorded as a `Keep:` rather
than used to widen the diff.

The grid went from three columns to four. Four tiles in a three-column grid strands one on a second
row, and the label is `kcal` rather than `Calories` because four labels share 412 dp minus the
gutters — the sibling screen already labels its tiles by unit (`min`, `km`).

## Verification

6 tests, **five mutations kill them**: the tile showing `0` instead of a dash, the grid staying at
three columns, the web response being discarded again, the device path pushing without pulling, and
the local `Stat` copy coming back. Full unit suite **6,351 tests**; `pnpm check:rules` **Ran 67 of
67** — including the rule about revalidating after a local write rather than around it, which the
device path had to satisfy. `tsc` and lint clean.

**Not exercised:** the device, and it owns both interesting cases. **(a) Offline** — finish a walk with
no signal and the tile must stay `—`; the push never happens, so nothing fills it, and the sandbox
cannot produce that. **(b) The fill itself** — the `—`-then-number transition depends on a real pull
returning a real derived row. Also unchecked: whether four tiles sit comfortably in one row at 412 dp.
Assertions here are source-level because the screen needs a canvas, a native SQLite store and a real
save, and both vitest projects run `environment: 'node'`.
