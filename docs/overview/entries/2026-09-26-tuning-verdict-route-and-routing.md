# Tuning — the fix was one import the repo already had, and the announcement may never reach him

**Branch:** `tuning/verdict-route-through-nightsessions` · **2026-09-26**
**Filed:** `TN-84` (`Lane: O`) · `TN-85` (`Lane: B`) · corrected `TN-83` · rewrote the Tuning baton
**Plan:** [`docs/superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md`](../../superpowers/plans/2026-09-26-outlier-gated-rating-prompt.md)

## The correction that matters most: TN-83's fix was wrong, and it was wrong in the way this repo has a rule about

`TN-83` (#1708, merged 08:56Z) reported that `TN-81`'s verdict judges naps and zero-hour fragments as
nights, and recommended **"select one night per date — longest row, or a main-sleep flag if one can be
derived."** Checking the backlog for prior art before that reached an implementer found `Q-76`, shipped
2026-08-05:

> The `isAnalysableNight()` predicate it proposed was **not built** — `nightSessions()` in
> `packages/shared/src/health/sleep-night.ts` already did both halves of the work (circadian nap/night
> split, then gap-merge), so the fix was routing eleven read sites through the existing helper rather
> than adding a second rule beside it.

So the helper exists, its header opens with *"One Formula, One Place"*, **15 sites route through it, and
the verdict path is the one that does not.** The fix is one import in `LA-149`'s wiring.

**The recommended rule would also have been wrong on its own terms.** That header carries the
measurement: the one genuine fragmented night in this history is **2.53 h + 4.02 h across a 105-minute
gap**, and a longest-row rule scores it as a 4.02 h night instead of merging it to 6.55 h. Three
nap→night transitions have *smaller* gaps than that real fragmented night, so no gap threshold
separates them either — which is why the helper classifies by circadian position first
(`NIGHT_BAND_START_HOUR` 21 → `NIGHT_BAND_END_HOUR` 10, `ALWAYS_NIGHT_MIN_HOURS` 4 as the shift-work
escape). A sixteenth divergent implementation, and a worse one.

**And the severity was understated.** This is not a new bug: `Q-76` found every consumer answering
*"which row is the night?"* for itself and **all of them answering it the same wrong way**. The helper's
header records what it prevented — *"a Sleep Score of 5 on a 7.86 h night, and — because the rollup
folds its pick into the checkpointed EMA baselines — it poisoned every later z-score too."* That is the
same two-directional failure `TN-83` re-measured independently, a month later, without recognising it.
Known, named, fixed, documented — and reintroduced by not reaching for the helper.

The sweep numbers in `TN-83` (0.5 → 10.9 announcements per 30 nights) measured the **wrong population**
and are now marked void; they have to be re-run against nights.

## TN-85 — the announcement gets one showing, on the surface with a dismissal habit

Before more effort went into *what* is announced, the question was whether it can be seen. From source:

- The morning sheet **auto-opens once** a day (`session-select-content.tsx:791`), only when no morning
  check-in exists for the local day.
- `markMorningCheckinPromptDone(tz)` fires **`onClose`** (line 1398) — dismissing or saving retires it
  for the day.
- The effect lives **only on `/session-select`**. Open the app to Home and never navigate there, and
  nothing is announced at all.

The instrument is the owner **disagreeing** with a verdict. He has saved **82** of these sheets in three
months and touched a scale in **3**, so dismissal is the established behaviour on this exact surface —
and here dismissal is indistinguishable from having read it, and final for the day. That is
`OR-171`'s silence trap arriving by construction rather than bad luck.

Recommended: a durable second home for the verdict (the Home sleep card) so a missed modal is
recoverable. The modal keeps the prominent outlier announcement. No schema — `TN-81` already persists
the verdict and the response state. `TN-82` now carries a "read `TN-85` first" warning, because
building it modal-only makes near-zero corrections uninterpretable.

## Routing, per the owner's instruction

*"nothing should need to be answered here; and if anything requires me for building; mark it for ORC."*

`TN-82` carried an `Ask: owner` for the announcement copy. Split out as **`TN-84`, `Lane: O`, ungated**,
with drafted copy to approve or edit rather than a bare question:

- ordinary day — `Sleep looks normal — filled in for you.`
- outlier — `Slept 5h10, 90 min later than usual. Marked this a poor night — tap if that's wrong.`

Numbers before verdict, because a verdict is arguable only when its evidence is visible; and it asks for
a **disagreement**, never a rating. `TN-82` no longer waits on it.

## No DV commission, and the reason

Two candidates were considered and both were answerable from source, which per `docs/agents/README.md`
disqualifies them — re-running a question that has an answer is the device agent's time spent on
nothing. **Where the fragments come from**: known, `nightSessions()` classifies them. **Whether the
sheet appears on Home**: no, the effect is in `session-select-content.tsx`. The announcement copy is a
looks judgement, so it goes to `O` and waits for the owner, not to `DV`. The APK pass owed on `TN-82`
was already recorded on that entry.

## Baton

Rewritten (743 → 734 lines, baseline lowered to match). Its header had said `Next ID: TN-30` while the
real next free was `TN-84`, and everything under "Now" predated the TN-55…TN-80 run. It now carries the
verdict thread, the void sweep, `TN-85`'s constraint, and the owner's 2026-09-26 rule that even a
genuine tuning question is filed `Lane: O` rather than asked in-session. The method and
do-not-re-litigate sections were left intact — extracting those is a separate chore, not something to
do quickly while editing state.

## Verification

`pnpm check:rules` — Ran 80 of 80, all passed. `check-backlog-pointers` — 535 entries, no duplicates,
no cycles. Docs-only; nothing device-gated here.
