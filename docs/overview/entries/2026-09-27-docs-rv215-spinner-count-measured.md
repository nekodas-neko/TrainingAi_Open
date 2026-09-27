# 2026-09-27 — RV-215 ③ measured: 60 of the 88 spinners are correct (docs only)

**Branch:** `docs/rv215-spinner-count-measured` · **Lane:** Implementation B · **Code changed:** none.

## What this was

`RV-215` ③ — *"88 bare `Loader2` spinners in 57 files, against skeletons in 58, and the `EmptyState`
primitive used in only 10"* — headed Lane B's queue as the entry's last open item. It was measured
before being built, and it is not buildable as written.

## What the 88 actually are

| Kind | Count | Verdict |
|---|---|---|
| In-button, beside a `disabled` prop | **60** | Correct. A control showing it is working. |
| Content stand-ins | **23** | Candidates — but **7 are admin**, not daily screens |
| Unclear | 5 | Need reading |

At least one of the 23 is also correct: `food-database-results.tsx:37` is a 12 px spinner beside a
section label while a search runs — inline, not standing in for content.

So the daily-screen subset the item asked to do first is **16 sites**, eleven of them nutrition, not
88 across 57 files.

## The part that makes it unbuildable as written

**`EmptyState` is not a loading state.** It takes `{ icon, title, action }` and says *there is nothing
here*. "Convert spinners to `EmptyState`" folds three different states into one:

- a spinner filling a content area wants a **skeleton**;
- an empty result wants **`EmptyState`**;
- a failed one wants an error with a retry — which is what ① already shipped.

So the low `EmptyState` count (12) is not evidence of debt, and converting against that target would
make screens claim emptiness while they are still loading.

## Re-scoped rather than half-built

The item now names what is actually buildable — the centred content-area spinners on daily screens
become row-shaped skeletons, with `food-list.tsx:195` as the reference case, since `loadingMeals` is
already a prop and the state is owned by the parent. **Per site it is a judgement, not a rename**,
which is why it stays an entry rather than becoming a sweep. No site was converted: building against
a category error would have been the wrong call, not a fast one.

**This is the third over-claim in this one entry from a static read.** ② was wrong about all three
cards it named (found 2026-09-27), and ③ conflates three states. Sweep 63 read this at source, and
every item of it that has since been rendered has come back smaller.

## Also cleared

**`RV-214`** — ①③④ shipped in #1775, ② does not reproduce, and ⑤ is a pick, so nothing was left for a
lane. ⑤ splits to **`LB-173`** (`Lane: O`): the session card's Start Workout has no icon, the
pre-workout screen's carries a dumbbell, and *"use the same variant"* does not say which. Filed with
**no recommendation on purpose** — nothing in the repo favours either direction, and inventing one
would dress a coin toss as analysis.

## Not exercised

Nothing rendered and nothing on-device: the classification is a static pass over `app/` and
`components/`, which is the same kind of read that produced the over-claims above. It is reliable for
the in-button split (an enclosing `<button>`/`disabled` is unambiguous) and it is a **starting list,
not a verdict**, for the 23 — `food-database-results` is already one it got wrong, and that is
recorded on the entry rather than smoothed over.
