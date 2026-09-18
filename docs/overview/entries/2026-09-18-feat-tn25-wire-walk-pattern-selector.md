# 2026-09-18 — TN-25: the guided walk's block structure is prescribed, not reopened

**Lane B.** Branch `feat/tn25-wire-walk-pattern-selector`, v1.458.0.

## What shipped

`recommendWalkPattern` landed on 2026-09-16 and **had no caller at all**, so the owner's ask —
*"I'd like the fast/slow rates to be varying and assigned to me"* — was not actually met by it: the
walk screen still opened on whichever preset was used last. This wires it.

- **`lib/walk/walk-pattern-config.ts`** (new) — maps a `WalkPattern` to `sets`/`fastSec`/`slowSec`.
- **`components/guided-walk/walk-config.tsx`** — reads the week's zone quota through the shared
  `cardio-week` key and applies today's pattern on open.

## The two things the selector could not supply

`recommendWalkPattern` deliberately returns block lengths and nothing else, so an HR-band change
cannot move the prescription. That leaves a gap the wiring has to close:

1. **No set count.** `WalkPattern` is `{id, label, fastMin, slowMin}` — a shared test pins that key
   list. Sets are derived from a fixed total: `round(30 / (fastMin + slowMin))`.
2. **No way to express a pattern with no alternation.** `steady_brisk` and `easy_steps` are
   **byte-identical in the table** (both `0/0`) and differ only in which block they are. One set with
   the other half at zero gives exactly that, because `buildIntervalPlan` drops zero-length segments
   — `steady_brisk` becomes one 30-min `fast` segment, `easy_steps` one 30-min `slow`. Collapsing
   them would turn a step-volume walk into a graded one, so a test pins the two apart.

**Duration is held at 30 minutes on purpose.** TN-25's own `⛔ One session, three variables` warning
is that 2026-09-09 changed block length, recovery and total at once, so nothing in the record
separates their effects. A prescription that also moved duration would repeat that confound; holding
it fixed makes block structure the single variable the selector moves.

## The decision TN-25 delegated to Lane B: pre-set, not suggest

The owner asked to have it *"determined for me"*, which argues for pre-setting — but the entry
flagged the hazard: `walk-config.tsx` autosaves `customConfig` on **every** config change, so a
prescription applied on open could silently overwrite the walker's own saved setup.

Handled rather than accepted. `Today` is a **fixed carousel slot at index 0**, reserved whether or
not the recommendation has arrived — so indices never shift under the selection when the fetch
resolves, and the autosave branch that writes `customConfig` never fires for it. Custom survives
untouched; swipe to it and it is exactly as it was left.

Auto-apply is guarded on a `touchedRef`, not on config content: a prescription that happens to equal
what is already showing is still the app's choice, and a walker who has already swiped has made
theirs.

## Verification, and what it cannot cover

- `lib/walk/__tests__/walk-pattern-config.test.ts` — 4/4. Pins the arithmetic, the two continuous
  patterns staying apart, and duration staying fixed across all four.
- `e2e/tn25-walk-prescription.spec.ts` — 2/2. Asserts the prescription reaches the steppers the walk
  actually runs from, and that Custom survives. Deliberately does **not** pin *which* pattern: that
  depends on the seeded week's Zone-2 gap, and pinning it would test the fixture.
- **Mutation-tested, both halves.** Dropping `setPresetIndex(TODAY_INDEX)` from the auto-apply turns
  both specs red; making `Today` autosave like `Custom` turns the second red at its flip-to-Custom
  assertion. Neither guard is decorative.
- `Ran 75 of 75` Custom Rules · tsc clean · tests-typecheck at baseline (320 errors, 90 files) ·
  lint 0 · component-size OK.

**Not exercised:** the S25 itself — GPS, cadence and the chest strap are unreachable from the web
harness, and a continuous (one-block) prescription has never been walked. `getLocalStore` returns
null on web, as always. That check is what TN-25's remaining `Keep:` line asks for.

## A correction to my own first attempt

The quota read was written as a hand-rolled `useEffect(… cachedFetchToday …, [])`, copied from
`running-plan-content.tsx`. That is one of the 36 sites frozen by `check-fetch-once-effects.js`, and
copying a frozen debt site is exactly what the check exists to stop — it failed the local gate.
Converted to `useCachedValue(..., { today: true })`, which is the rule: `cardio-week` is evicted by
four separate write groups and a fetch-once effect would never hear any of them.
