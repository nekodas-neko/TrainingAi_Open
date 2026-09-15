# 2026-09-15 — BF-163: the intensity chip claims only the load it measures

**Branch:** `fix/bf163-intensity-chip-tooltip` · **Lane B**

The owner, on the prescription card: *"Is hypertrogpy the correct tag?"*

**Yes — and that was the problem.** `intensityZoneForPct` maps %1RM to a band with no reference to
reps: 65–75% → Hypertrophy. His squat is prescribed at **72.5%**, so the chip was right by its own
definition. The thing contradicting it was the chip's **own tooltip**, `typically 8–12 reps`, sitting
one line above a prescription of **2×6** — a rep count the same table calls **Strength**.

So the chip was a single UI element making two claims from one input, and only one of them was
supported by that input.

## What shipped

```
- title={`${zone.range} of 1RM · typically ${zone.reps}`}
+ title={`${zone.label} · ${zone.range} of 1RM — named from load alone`}
```

**Not a deletion.** The entry's "honest minimum" was to drop the rep clause, but dropping it outright
leaves a tooltip that only repeats the label already visible in the chip — and a reader whose reps do
not match the band's name still has no way to find out why. Naming the input is what makes the chip
honest rather than merely quiet.

`zone.reps` is now unused — it was that tooltip's only consumer repo-wide — and is **deliberately
left in place**. The better answer needs it, and removing it is a `packages/shared` edit, which is
Lane A's.

## The lane the entry got wrong

BF-163 was filed `Lane: B` while naming `packages/shared/src/workout/intensity-zone.ts`, which is
**Lane A** by the path rule. The two halves genuinely split: the tooltip string is composed in the
card, so the shipped half is pure Lane B and touched no shared file. Recorded on the entry so the
next reader does not re-derive it.

## What is deliberately not done

**The load and the reps genuinely disagree at 72.5% × 6.** The chip is not merely mislabelled, and
picking a side needs a rule the app does not have: `goal-ranges.ts` puts hypertrophy at
`repMin: 5, repMax: 12`, so 6 is legal for the goal, while the display band calls 6 Strength. Two
tables, two rep opinions, and the card shows one of them. Judging the **pair** is the better answer
and is Lane A's — kept on the entry, and not urgent now that the chip asserts nothing false.

## Verification

Two layers, and the second exists because the first is not enough.

The **unit test** reproduces the contradiction from the real prescription, but two of its four
assertions are source matches — exactly the shape that passes vacuously if an edit never reaches the
render.

So there is an **e2e that reads the rendered `title` attribute** off the chip, with the owner's own
row as the fixture (72.5% × 6, a real `session_exercise` on the seeded program). Run against `main`'s
unfixed card it captures the defect verbatim from the live DOM:

```
Expected substring: "named from load alone"
Received string:    "65–75% of 1RM · typically 8–12 reps"
```

That received string, one line above a rendered `2×6`, **is** the owner's report. Both layers go red
without the fix.

## Not exercised

**No device pass.** A `title` attribute is a hover affordance; on the S25 it is reachable by long
press in the WebView and worth confirming reads correctly there. Kept as BF-163's `Keep:` ②.
