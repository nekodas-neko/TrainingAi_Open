# 2026-09-30 — the morning check-in compares to normal, and the marker moved with it

**Branch:** `feat/or206-compared-to-normal` · **v1.486.11** · `OR-206`

The owner, on the S25: *"I dont like the comparison to the yesterday. Maybe comparison to
\"normal\"."* Same three options, same order. This is the surface half of `OR-206`; the schema half
was `LB-190` (#2025) and the pre-selected neutral was `LB-191` (#2026), both earlier today.

## The change is two lines in two files, and they are ONE change

`components/checkin/vs-normal-picker.tsx` asks **"Compared to normal"**, and
`packages/shared/src/types/day-checkin.ts` sets `CURRENT_VS_QUESTION` to `VS_QUESTION.NORMAL`.

**They must never move apart.** A prompt asking one question while rows are stamped with the other
mislabels every row written in between — silently, because each row looks internally consistent and
nothing downstream can detect it. `vs_question` exists precisely so those two populations are never
pooled, and a marker that lies is worse than no marker.

So the guard is the real deliverable here: `tn58-vs-normal-control.test.ts` reads the prompt out of
the picker and asserts `CURRENT_VS_QUESTION` agrees with it. **Control-run** by flipping the
constant back — it fails with *"the screen asks 'compared to normal' but rows are stamped 1 — move
the copy and the constant together, never one alone."*

A second guard came free: the label's `id` and the `aria-labelledby` pointing at it must match. A
renamed prompt with a stale `id` leaves the radiogroup with **no accessible name at all**, which no
rendered assertion in this repo would catch — the e2e spec finds the group *by* that name, so it
would fail with a confusing "not visible" rather than the real reason.

## Whose line was the constant

`packages/shared/**` is Lane A's. **Lane A handed this one line over in the code itself** — its
comment read *"OR-206 moves this to NORMAL in the same change as the copy"* — and `LB-190`'s journal
entry says the same. Taking it here is what that instruction asks for; splitting it into a Lane A PR
would open exactly the window where the prompt and the marker disagree.

## Measured, not inferred

A real Save driven through the sheet, then read back out of Postgres:

```
 log_date   |  phase  | vs_normal | vs_question
 2026-10-01 | morning | same      |           2
```

That is the whole claim of this PR in one row: the seeded neutral reaches the column, and it is
stamped as an answer to the NEW question. (The probe row was deleted afterwards.)

## A doc that had gone false

`docs/module-map.md`'s row for this field still said **"there is deliberately no neutral, which is
also why it needs no `*_touched` twin: unlike a slider seeded at the midpoint there is no position
to accept by leaving it alone."** `LB-191` seeded the neutral hours earlier, which makes the field
*exactly* the midpoint-slider case that argument excluded. Written by `LB-190` before `LB-191`
landed, so neither PR's author saw it go stale. Corrected here, pointing at `LB-198` for the twin.

`LB-197` also lost its premise — it said a shorter label would "ride `OR-206`". `OR-206` has now
shipped and deliberately left the three option labels alone, since he never asked to change them.

## Verified

`npx tsc --noEmit` · `pnpm check:rules` **Ran 86 of 86** · `pnpm test` · the unit file **8 tests**
(two new, both control-run) · the e2e spec **4 passed** against the new prompt, which is also what
proves the copy reached the screen — the locator finds the group by its accessible name.
Rendered at **384 px dark, portrait**.

## Not exercised

- **The S25.** Harness only. No device gate is owed: this is a string, an `id`, and a constant —
  no safe-area, gesture, notification or native-plugin surface.
- **The outbox path for a mutation queued before this deploys.** `resolveVsAnswer` reads the
  pre-rename `vsYesterday` key as question 1, which is `LB-190`'s code and its own test; nothing
  here re-tests it.
- **Whether "Compared to normal" is the wording he wants.** It is the entry's reading of his words
  and was not put back to him. Changing it later is one line plus this guard.

## A correction to something this session wrote an hour earlier

`#2026` came back with **all four E2E shards green** — including `meal-type-reassign`, which
`#2026`'s own PR had just recorded on `LB-56` as a confirmed sharding casualty that *"failed its
automatic retry in the same run"*.

Recorded rather than left, because a claim that has already moved is worse than none. **It does not
restore the flake reading.** `#2026` renamed an e2e spec, the shards are filled in file order, so
which specs ran beside `meal-type-reassign` changed between the two runs. That is this entry's own
thesis — *which specs run together decides it* — so the sharper statement is that the spec is
sensitive to its shard's contents, and **passing is as uninformative as failing** until it creates
its own state.
