# 2026-09-28 — the Resting HR cell, and why both proposed fixes were impossible

**Branch:** `docs/resting-hr-cell-mockup` · Orchestrator

`LB-172` needed a mockup before it could reach the owner. Drawn:
[`docs/design/2026-09-28-resting-hr-cell.html`](../../design/2026-09-28-resting-hr-cell.html) ·
[hosted](https://claude.ai/artifact/7ngUaPpJieYqDkfBpJAiEC)

## The defect

Three of Home's four cells are 0–100 scores. The fourth is a heart rate, drawn in the same ring at
the same weight, so **58 reads as a score** and nothing says otherwise but the words underneath.

## Both fixes `RV-211` proposed are unavailable, and the entry measured it

| Proposed | Measures | Against | Verdict |
|---|---|---|---|
| `"58 bpm"` at the value's font | 140 px | 82 px cell | 1.7× the whole cell |
| `"Resting HR (bpm)"` in the label | 97 px | 60 px label today | overflows by 15 px |

So "just add bpm" is not a small change — it is not available in either place the entry meant. What
is free is the caption slot under the number: the component already draws a cue word there at
7.5 px, and in the default style that slot renders nothing.

## The fork, and what actually decides it

There are **nineteen** user-selectable ring styles. `nolabel` removes the label deliberately — the
glyph is the name — and `overlap` has no caption slot, so no single treatment fits all nineteen.

- **(a) a `bpm` caption**, only where a label already exists. Recommended: one word, reversible in
  one component, and it does not re-open a visual language he has chosen between nineteen times.
- **(b) drop the ring on the HR cell.** The honest version of "it is not a score" — a ring encodes
  0–100 progress and 58 bpm has no such scale. Fixes all nineteen styles.

**The page asks one question that settles it without taste entering into it: does he use `nolabel`
or `overlap`?** In those two, (a) changes nothing and the ambiguity is at its worst, because nothing
names the metric at all. If he does, (b) is the only option that works.

**Not device-verified** — drawn from harness geometry, not screenshotted, since the row needs live
scores. (b) owes a device look before shipping because it changes a shape rather than adding a word.

**Not exercised:** a static page. No component changed.
