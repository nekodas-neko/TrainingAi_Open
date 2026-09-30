# 2026-09-30 — LA-158: the Resilience tile now says when, and says something when it has nothing

**Branch:** `feat/la158-resilience-staleness-and-shortfall` · v1.486.7. The surface half; the engine
half shipped 2026-09-27 (Lane A).

Lane B's READY queue was **0**, so this came off the KEEP list — `LA-158`'s residue, which read
*"the Lane B render above"* and was buildable work sitting where `next-item.js` prints
*"Not new work"*. That is the shape `check-backlog-pointers` warns about
(**35 `Keep:` residues read as buildable**) and `LA-158` was on its list by name. Building it beat
filing a note about it.

## Two defects behind one missing render, and the live one was the quieter

The engine half already corrected the entry's premise: the tile had **not** gone blank.
`buildReadinessPayload` reads a **7-day** window and takes the most recent row carrying a level, so
on 2026-09-27 the tile was **rendering 09-22's level as if it were today's, with no date** — and
would have gone silently blank once 09-22 left the window. Staleness first, absence later.

The surface rendered neither field, and gated the whole tile on `ownResilienceLevel != null`. So:

| payload | before | now |
|---|---|---|
| level from today | `Resilience · Adequate (3.2)` | unchanged |
| level from 5 days ago | `Resilience · Adequate (3.2)` — **no date** | + `From 22 Sept, not today.` |
| no level, coverage observed | **nothing at all** | `Resilience · Not published yet` + the observation |
| no level, no observation | nothing | nothing — see below |

**The gate moved from the level to the data.** `health-score-detail.tsx` now renders the tile
whenever there is a payload and the tile itself returns null when there is neither a level nor an
observation. Gating on the level at the call site is exactly what made a closed coverage gate
indistinguishable from a healthy quiet day.

## The sentence is an observation and must not become a diagnosis

The entry is emphatic and the reason survives a read of the code: the payload sees **7** days while
the model gates on **`windowDays` (14)**, so a shortfall the payload can see is *consistent with* the
coverage gate having closed **without establishing that it did**. The line states the two counts side
by side and draws no line between them:

> 2 of the last 7 days had enough daytime coverage; the model needs 5 of 14.

`readiness-payload.ts` already pins the absence of a `reason` field for this reason. A unit test now
pins the absence of the *words* — no `because`, `that is why`, `due to`, `caused` — so a later
tidy-up cannot turn the pairing into a verdict by rewording it.

It degrades rather than guessing. Every threshold is `null` when the resilience constants were not
injected on the request, which is a different thing from a threshold of zero, so each clause appears
only when its own numbers are there: no `minValidDays` drops the requirement clause, no
`daysMeetingCoverageGate` falls back to *"Checked the last 7 days."*, and `daysSeen: 0` says nothing
at all — an absence of observation is not an observation.

**`From <date>` is `RV-202`'s wording, deliberately.** Its amber source pill on the workout screen
already says `From 26 Sept` for a payload built on an earlier day. One vocabulary for one idea is
`RV-208`'s point, and this is the second surface to need it.

## Rendered, because the entry is about what the screen says

`e2e/la158-resilience-surface.spec.ts` — **4 passing** at 412 px dark, one per row of that table.
The fourth is the one that must NOT grow a tile: a payload from before these fields existed renders
none, and the test proves the *page* is up so a missing tile is a missing tile rather than a failed
load.

**The overlay patches the real response rather than replacing it.** `ReadinessScoreResponse` is
large and `readiness-content.tsx` hands most of it to `breakdown`/`contributors` callbacks, so a
hand-built body would break the page for reasons unrelated to this entry. The handler does a real
`route.fetch()` and overrides five fields — which means `tolerateTestEnd`, because a request still
in flight when the test ends rejects *outside* any test and takes a shard red with zero failed
tests. `check-e2e-route-tolerance` refuses the unwrapped form; it is the rule I added two days ago
and the first time I have been on the receiving end of it.

**The long line was measured rather than assumed.** The shortfall sentence is the longest this tile
can carry and it wraps by design. Wrapping is not the defect — overflowing the card is — so the
spec measures that: sentence **328 × 33 px at x 55** inside a tile **380 × 71.5 px at x 16**, itself
inside 412. Two lines, contained.

## Verified

- `components/health/__tests__/la158-resilience-copy.test.ts` — **10 tests** on the two pure
  sentence builders, including the no-diagnosis property, all four degradation paths, the singular
  day, and a string comparison that cannot drift on the device clock.
- `e2e/la158-resilience-surface.spec.ts` — **4 passing**.
- **Control-run, and it discriminates.** Neutering `resilienceAsOfLine` and restoring the old
  `ownResilienceLevel != null` gate reddens **exactly** the two starred tests — the two new
  behaviours — while the today's-level and no-fields tests stay green, because those describe
  behaviour that already existed. A spec that went all-red would have told me less.
- `npx tsc --noEmit` · `pnpm lint` 0 errors · `pnpm check:rules` **Ran 86 of 86** ·
  `check-memo-prop-stability` clean (96 memoised, 0 defeated) · `pnpm test` · `pnpm build` ·
  `check-e2e-route-tolerance` and `check-e2e-stub-dates` clean.

`unavailable` is passed as an object and that is memo-safe here: it is a field off the fetched
payload, not a literal at the call site, which is what `check-memo-prop-stability` actually flags.

## Not exercised

- **Real coverage numbers.** Every case is overlaid, so the sentences are proven to render from
  *given* values. What the owner's own week says is a production read, and `LA-160` owns the
  wear-vs-ingest question behind it.
- **The device.** Two text lines inside an existing tile on a pushed route, measured for containment
  at 412 px in Chromium — no layout moved, so nothing is filed as owed. Samsung WebView's font
  metrics differ, and the line that would suffer is the wrapped one.
- **Whether the coverage gate is why nothing published.** Unknowable from here by construction, and
  the copy is written so that it stays unclaimed.
