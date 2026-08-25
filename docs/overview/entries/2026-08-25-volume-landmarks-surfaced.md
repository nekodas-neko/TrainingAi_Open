# 2026-08-25 — the volume landmarks reach the card that was guessing (Q-305, the landmark half)

**Branch:** `feat/surface-volume-landmarks` · **Lane B** · no schema, no route, no APK.

## The finding was sharper than the entry's

Q-305 says the landmarks are *"computed and never shown to anyone"*. Re-verified against `main`, and
it is worse than unshown: **`weekly-muscle-sets-card.tsx` was already showing a band — a hardcoded
generic `MIN_TARGET = 10` / `MAX_TARGET = 20` with `barColor` thresholds at 15/10/6.** So the app has
been computing correct per-muscle MEV/MAV/MRV in `packages/shared` and rendering a made-up yardstick
next to it, every week.

**The goal multiplier is what makes that material, and Q-305's own history is the proof.** Its first
pass compared the owner's weeks against the raw hypertrophy row and concluded lats and upper back
were below MEV. The active program is `powerbuilding`, which `volumeLandmarks` scales by **×0.8** —
against the table the app actually uses, both are **in range**, and three other muscles are over
**MRV**. Reading the wrong row inverted the finding from "not doing enough" to "doing too much",
which is exactly what a generic 10–20 band does silently.

## What shipped

`components/health/volume-band.ts` — a pure `volumeVerdict(goal, muscle, sets)` over the shared
`volumeLandmarks`, returning the band **and its word**: `below MEV` · `in range` · `above MAV` ·
`above MRV`. Two of the four are red and mean opposite things, so the word is load-bearing, not
decoration — this is the colour-only-state rule with real teeth.

The card uses it whenever a training goal is known and the program supplies no explicit per-muscle
target. **A program target still wins**: that is the user's own number, not a reference range.

The goal needed no Lane A change. `workout-data:meta` already carries `program.trainingGoal`, and
`health-content.tsx` already fetches that exact key — it is captured from both the sync cache seed
and the network callback, so first paint has it too.

Two details that would otherwise have shipped wrong:

- **The bar gained a second marker at MRV.** With only the MEV line, a bar past maximum recoverable
  volume just looks like a long bar.
- **The footnote follows the bands.** It read *"Vertical line = 10-set minimum. Green = 10–14 sets ·
  Blue = 15+ sets."* — caught in the rendered output, not by reading the diff. A caption that
  disagrees with the chart above it is worse than no caption.

## Verified

**Unit** — `components/health/__tests__/volume-band.test.ts`, **13 passed**: all eight muscles from
the entry's 56-day measurement land in the bands it recorded (glutes/hamstrings/triceps over MRV,
shoulders/biceps above MAV, lats/upper back in range, calves under); the goal multiplier moving lats
from `under` to `in`, which reproduces the entry's own correction; each landmark asserted on the
boundary it names; `core` resolving to `abs` rather than falling through to the default (recorded on
the entry as checked-and-clean, pinned so it stays that way); and the two red bands carrying
different words.

**Rendered** on `/health` → Training, against three seeded muscles chosen to hit three bands:

```
Triceps  above MRV  22 sets
Lats     above MAV  11 sets
Calves   below MEV   2 sets
vs MEV–MRV for your goal
Lines = MEV (minimum effective) and MRV (maximum recoverable), scaled to your training goal.
```

Seeded rows removed afterwards. `tsc --noEmit` clean · eslint unchanged (1 pre-existing warning) ·
`check-component-size` clean · `pnpm check:rules` **Ran 56 of 56**.

## The push:pull half is deliberately NOT here

Q-305 says to do the push:pull ratio on the same surface *"rather than as two cards"*, and doing it
here would have meant inventing a muscle → movement-pattern taxonomy inside a component. **There is
no push/pull grouping anywhere in the repo** (checked). That is domain math, it belongs in
`packages/shared` beside `normalizeMuscle` and `MUSCLE_LANDMARKS` under **One Formula, One Place**,
and `packages/shared` is Lane A's. Building a second private copy in `components/` to satisfy "do
them together" would be the wrong trade.

Left on the entry as the remaining half, with the reason, rather than silently dropped.

## Not exercised

- **On device.** The card is browser-verifiable and was verified there, but not at S25 width in the
  APK, where the added band word sits beside the set count on a narrow row. `Gate: device`.
- **The `in range` band was never rendered** — the three seeded muscles deliberately hit the other
  three. It is covered by four unit cases including both boundaries.
- **The shared-treatment question Q-305 raises** (whether Q-278 / Q-302 / Q-305 want one common
  design for "computed and discarded") is untouched. Those entries are not mine to close, and
  answering it inside one card would have prejudged it.
