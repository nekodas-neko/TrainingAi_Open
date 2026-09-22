# 2026-09-22 — `layout-384`: five places a 384px screen cut the wrong thing

**Branch:** `feat/layout-384-truncation-batch` · **Lane:** Implementation B · **Version:** 1.464.6

Five entries, one PR, one verification — the batch's whole point. All five are a class combination
whose effect is geometric.

## What shipped

- **RV-92** `pre-workout-screen.tsx` — `truncate` sat on a **flex container**. `text-overflow`
  applies to inline content of a *block* container; on a flex container the name became an anonymous
  flex item at `min-width:auto`, so it never shrank, no ellipsis painted, and the green "done today"
  tick after it was **clipped out of existence — a completed exercise read as unlogged.** The name
  is its own `truncate` span now, inside a `min-w-0` flex parent.
- **RV-93** `injury-notice.tsx` — the chip was `shrink-0` at `max-w-[11rem]`, taking 176 of 352px
  whatever the title needed. Mid-set, "Single Leg Romanian Deadlift" read `Single Leg Roma…`.
- **RV-94** `food-row.tsx` — 162px of name column is ~22 characters against **130 of 337 real items
  longer than that**. `line-clamp-2`, which the row's existing `min-h-12` already accommodates.
- **RV-95** `weekly-stats-hub.tsx` — the unit rode with the value in a 74px cell, so `kg` wrapped to
  a second line for **every non-zero week**, dropping the VOLUME caption ~22px below its three
  neighbours. It moves to the `unit` line the other three tiles already use.
- **RV-96** `done-screen.tsx` — name and `· 3/4 sets` shared one truncating span, so the caveat on
  the HRR number was always cut first, and cut **precisely on the longest names**.

## All three "not established" questions settled, two of them against the entry

- **RV-93 asked whether the chip fires on a specific exercise.** It does, and on the entry's own
  example: the single unresolved injury is `lower back`, and **"Single Leg Romanian Deadlift" carries
  `lower back` as a secondary muscle** (ten library exercises do). Not hypothetical.
- **RV-94 said "check first, it may make the fix unnecessary" —** whether the grey secondary line
  disambiguates the colliding pair. It *does* differ: both are Sanitarium, at **350 g and 258 g**.
  But it differs **at the tail**, which is exactly what truncation removes, and the secondary line
  truncates too. So it never disambiguated them, and the fix stands. One refinement to the entry:
  the rows are not quite "indistinguishable" — the calorie column already shows 259 against 208 —
  but nothing tells you *which* is the Choc Hit.
- **RV-95 asked whether `/api/weekly-stats` rounds `totalVolumeKg`.** It does, at `:115`. The
  fractional-widening worry is unfounded.

## The test caught a branch my own fix missed

`injury-notice.tsx` has two variants — a `button` when `onSwap` is given and a `role="status"` div
when it is not. The first pass fixed the button and left `shrink-0` on the div beside it. The
assertion is on `${shell} shrink-0`, so it failed, and the sibling was fixed before it shipped.

## Also in this PR: LB-125 split

LB-125 was filed an hour earlier, out of RV-91, **spanning two lanes in one entry** — the helper is
Lane A's, the five call sites Lane B's. `next-item.js` has no way to know that, so it printed at the
top of Lane B's READY while its first half was unstartable here. Split per the repo's own rule: the
helper keeps **LB-125** (Lane A), the call sites become **LB-126** with `Needs: LB-125`. Three of
those five are a bare `{ weekday: 'short' }` and cannot be converted until the helper has a style
for it, so starting LB-126 first would convert two of five and make the other three look deliberate.

## Verification

- `pnpm check:rules` — **Ran 75 of 75**. `tsc --noEmit` clean; lint clean (one pre-existing warning).
- **Controlled: all five cases go red against the unfixed files**, each naming its own defect.
- Source-shape by necessity — jsdom has no layout engine, so a rendering test would assert nothing
  about geometry.

**Not exercised:** ⚠ **no device sitting, and this batch is the kind that wants one.** Every fix is
a pixel claim at 412px. The arithmetic behind each is in the entries and re-checked here, but the
ellipsis, the two-line food row and the Volume tile's single line are unconfirmed on the S25.
