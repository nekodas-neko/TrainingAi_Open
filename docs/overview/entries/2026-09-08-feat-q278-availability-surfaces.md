## 2026-09-08 — The em dash gains a reason (Q-278, surface half)

**Branch:** `feat/q278-availability-surfaces` · **Lane B**

### What shipped

A score that could not be computed rendered `—`, which read the same whether nothing was recorded or
the personal baseline is simply too cold to judge what was. The engine half (Lane A, 2026-09-03) made
those distinguishable and put `availability` on `/api/readiness-score`; nothing consumed it. Now:

- **`components/health/score-gap-copy.ts`** — `scoreGapText(availability, metric)`, a pure function
  so the copy decision is testable in `node`. Two sentences, and the difference is the point:
  **"Nothing recorded for today"** (recording something fixes it) versus **"Not enough history to
  score this yet"** (only waiting does).
- **`health-score-detail.tsx`** renders it as a chip under the hero, on all three score screens —
  keyed on `aiSection`, which already carried exactly the three metric names the route reports, so
  no new prop for a value the component was holding. Under the hero rather than inside the ring: a
  128 px circle already holds a number, a band word and a label.
- **`oura-score-chip-row.tsx`** carries it in the **accessible name only**. Those cells are 92–96 px
  circles with no room for a sentence; a sighted user taps through to the screen that now explains,
  and a screen-reader user otherwise heard "Readiness: —" and nothing else. It slots into the
  existing `ariaLabelFor`/`qualifierPhrase` mechanism rather than inventing one.

Deliberately silent about a *degraded* score — one computed from an incomplete picture already has a
treatment via `limited` in `readiness-breakdown.tsx`, and a second sentence saying the same thing in
different words beside the number would be worse than none.

### Q-278 is not finished, and its lane flips back

The `Keep:` it carried is discharged, so it is rewritten to the half that remains: the route emits
`availability` for **readiness, sleep and activity only**, while **daytime stress (55%) and
resilience (33%)** — the two lowest-coverage pillars in the entry's own measured table — still render
dashes nothing can explain. `metricAvailability` is keyed on the metric name precisely so a sixth
costs nothing; what is missing is the route adding them. Lane flips **B → A**, having gone A → B when
the engine shipped — the lane follows the open path.

Sleep and activity will never say `awaiting_baseline` (they have no contributor breakdown, so they
report present/absent only). That is honest, and the entry now says so, because "fix" it by inventing
contributors for them is the obvious wrong move.

### Two guards this broke, both caught before pushing

**`sleep-provisional-surfaces.test.ts` pins `href: "/health/sleep"` and `provisional:
sleepProvisional` inside one 120-character window**, deliberately — asserting the prop and the field
separately would pass against a cell that reads the flag and never uses it. My `gapReason` line went
between them and pushed them apart. Fixed by moving the line **after** `provisional` rather than
widening the window: the guard's tightness is the thing that makes it work, and loosening a check
because your own line got in its way is how a guard stops guarding.

The full suite is what caught it. It was run because the previous PR in this session claimed a green
suite it had not run and CI found a real regression — the same lesson, one PR later, and this time
before the push.

### Verification

- **5 unit tests**, three driven through the real `metricAvailability` rather than hand-built
  literals — including the mixed-gap case, where a metric with one cold input and one absent one must
  resolve to `no_input`, because waiting cannot fix the half that has no data.
- **2 e2e cases** (`e2e/score-gap-reason.spec.ts`) driving the real readiness screen with the
  response intercepted — built from the genuine response via `route.fetch()` so every other field
  stays honest, with only the score and its availability replaced. Whether the seeded user happens to
  have a score today is a fact about fixtures; this is not.
- **Mutation-checked**: collapsing the two sentences into one — the exact regression Q-278 exists to
  prevent — fails 1 e2e case and 3 of the 5 unit tests.
- `pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · lint 0 errors · `pnpm build` exit 0 ·
  unit suite **802 files, 6,914 tests passed**.

This also discharges the engine half's stated **NOT verified** item: it recorded that an
authenticated `/api/readiness-score` response had never been exercised because the sandbox could not
mint a session. The e2e cases fetch the real route as the signed-in seeded user.

**Not exercised:** the APK. WebView surfaces carried by a Railway deploy with no rebuild. The chip
row's accessible name was not read with TalkBack on the S25 — the guard proves the string is in the
name, not that it reads well aloud.

Patch bump — user-visible copy.
