# 2026-09-27 — RV-211 ⑥ measured: both proposed fixes overflow the cell (docs only)

**Branch:** `docs/rv211-hr-unit-measured` · **Lane:** Implementation B · **Code changed:** none.

## What this was

`RV-211` headed Lane B's READY list with one item left open — ⑥, *"Resting HR sits in a score ring
with no unit… Add 'bpm', or style it differently from the scores."* The entry flagged that appending
a unit *"has to be MEASURED rather than assumed"*. So it was measured, in the harness at 384 px dark
on the seeded account, and **both of the fixes it proposes are impossible as written.**

## The measurement

A cell is **82 px** wide at the 384 px viewport.

| Proposal | Measures | Against |
|---|---|---|
| `"58 bpm"` at the value's own font (34.4 px) | **140 px** | 82 px cell — 1.7× |
| `"Resting HR (bpm)"` in the label | **97 px** | 82 px cell, label currently 60 px |

So "add bpm" is not a small change; it is not available at all in either place the entry meant.

What *is* available is a small caption under the number: the component already draws one there — the
cue word at 7.5 px — and in the **default** style `showDot` is `false`, so that slot renders nothing
and is free. Confirmed in the same measurement (`cueWord: null` on all four cells).

## Why it stopped being an implementer's call

**There are nineteen ring styles**, not the four the entry counted — `SCORE_RING_STYLES` in
`lib/home/home-prefs.ts` is user-selectable, and four renderers serve them. Two of them defeat a
caption outright: **`nolabel` deliberately removes the label because "the glyph is the name"**, so a
unit there fights the premise of the style, and `overlap` has no caption slot. No single treatment is
right for all nineteen, which is a fork rather than a fix:

- **(a)** the unit appears only where a label already does — cheap, reversible, leaves `nolabel` and
  `overlap` as ambiguous as they are today;
- **(b)** the HR cell is styled differently from the score cells — fixes every style at once, and
  changes the visual language of the row he reads every morning.

## What landed

**`LB-172`** (`Lane: O`, ungated), carrying the measurement, the fork, a recommendation of (a), and
what (b) is genuinely better at. Split out rather than left as ⑥ because **a question buried inside a
`Lane: B` entry is invisible to the Orchestrator** — the lane field is what routes it, which is
CLAUDE.md's own instruction for this shape.

`RV-211` keeps ④ as its `Keep:` — the header row that cannot hold the date and both pills, parked on
`LB-157` — and has **left READY**, because nothing in it is startable.

## A second finding, recorded on `LB-166` rather than dropped

While waiting on PR #1803's advisory E2E, it was **cancelled at 45m17s** — the job ceiling again, to
the second, with no superseding push. That is `LB-166`'s second occurrence, and the first one that
cost something: **#1803 added a spec, and the job died before reporting, so that spec has never been
verified in CI.** It is green locally (4 passed, control-run against the bug and against the entry's
own suggestion) and now sits on `main` with no CI verdict at all.

The entry has been updated. The distinction that matters is that the ceiling is now reached by an
**ordinary** PR, so the margin is gone rather than thin, and every spec added from here lands
unverified while this stands.

## Not exercised

Nothing on-device: the numbers are from headless Chromium at 384 px, so they are the harness's
metrics, not Samsung's WebView. They are comparative rather than absolute — 140 px against an 82 px
cell does not become available on a different renderer — but a mockup is still owed before any code,
and it should be drawn against these figures.
