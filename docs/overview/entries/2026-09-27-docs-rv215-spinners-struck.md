# 2026-09-27 — RV-215 ③ struck: the 88 spinners were 0 defects (docs only)

**Branch:** `docs/rv215-spinners-struck` · **Lane:** Implementation B · **Code changed:** none.

## The number shrank three times, and the last two were mine

`RV-215` ③ read *"88 bare `Loader2` spinners in 57 files, against skeletons in 58, and the
`EmptyState` primitive used in only 10."* It was the entry's last open item and headed Lane B's
queue. Reading every candidate site closes it with **no conversions**.

| Stage | Count | How it shrank |
|---|---|---|
| The entry | **88** in 57 files | a grep |
| Static classification (#1807, mine) | **23** stand-ins, **16** non-admin | 60 are in-button spinners beside a `disabled` prop — correct |
| Reading all 16 (this PR, mine) | **0** clearly wrong | see below |

## What the 16 daily-screen sites actually are

- **Four carry their own copy** — *"Analysing…"*, *"Reviewing your session against your recent
  data…"*, a toast with a label. A skeleton there would be **worse**: the wait needs explaining, and
  a shaped placeholder explains nothing.
- **Seven are inline busy states** — swapping an icon while a photo uploads, labelling a macro
  lookup, a chip in a builder row.
- **The rest stand in for a CONTROL, not content** — a small spinner where a meal-type picker will
  be, a GIF box.

## The reference case argues against itself

`food-list.tsx:195` looked like the clearest convert: a centred spinner filling the list area, with
`loadingMeals` already a prop so the state was owned by the parent. Two things killed it.

**It cannot know what follows.** After loading, the surface shows either saved-meal cards *or* "No
meals saved yet". Row-shaped skeletons would promise content that may not exist — a worse lie than a
spinner.

**And the parent already cache-seeds.** `saved-meals-sheet.tsx:129` does `readCacheSync('saved-meals')`
then `setLoading(false)`, so on a repeat visit the spinner never appears. The repo's instant-paint
rule — *a skeleton flash on a repeat visit is a bug, seed synchronously from cache* — is already
satisfied here. What remains is a cold first load, where a spinner is the honest thing.

Two sites are arguable and deliberately left: the GIF box in `exercise-preview-sheet.tsx:52` and the
collapsible in `achievements-section.tsx:48`. Neither is a defect, and converting two sites to close
a "57-file" item would be theatre.

## Why this is worth a journal entry rather than a quiet delete

**`EmptyState` is not a loading state.** It takes `{ icon, title, action }` and means *there is
nothing here*. The item's own framing folded three states into one count — loading, empty, failed —
and its low `EmptyState` use count was never evidence of debt. ① had already shipped the failed case
correctly.

**This is the fourth over-claim in this one entry, and the last two were mine.** ② was wrong about
all three cards it named. ③'s count was 88; my static re-scope said 16; reading them says 0. That is
the same lesson `LB-169` cost this morning, twice in one day: **a static classifier is a candidate
list, never a verdict.**

`RV-215` is removed from the queue — ① shipped (#1780), ② wrong, ③ struck.

## Not exercised

Nothing rendered and nothing on-device. Every judgement here is from reading the 16 sites and their
callers, which is the same method that produced the over-claims above — with the difference that the
claims being made are now *narrower* than the source, not wider. The two arguable sites are named
rather than folded into the "0" so a later sweep can disagree with a specific thing.
