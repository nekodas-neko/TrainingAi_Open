# 2026-09-30 — the comparative check-in opens on the neutral, and the dismissal now carries the weight

**Branch:** `feat/lb191-checkin-neutral-default` · **v1.486.10** · `LB-191`

The owner answered `LB-191`: **yes, pre-select "About the same"** — against the recommendation, and
reaffirmed after the cost was put to him. He was shown `TN-58`'s measurement (2 distinct values
across 96 check-ins, sd 0.29) and the specific objection, that a one-tap Save makes a reflexive
answer indistinguishable from a considered one on a field feeding readiness. He chose the default
anyway. That is settled and this entry does not re-litigate it.

## What shipped

`components/checkin/vs-yesterday-picker.tsx` exports `VS_YESTERDAY_DEFAULT: VsYesterday = 'same'`,
and `components/morning-checkin-sheet.tsx` seeds both its `useState` **and its close-reset** from it.
Two opens a day was the trap worth naming: a seed applied only at mount would leave the second open
showing nothing selected, so the guard asserts both sites.

**The constant lives in the picker, not the sheet.** The picker owns the option list, so a literal
`'same'` in the sheet could drift from the labels and seed a value the control does not offer.

## The one place the seed must NOT apply

`setVsYesterday(saved.vsYesterday ?? null)` — unchanged, and now load-bearing. A stored NULL is
either an answer he cleared or a row written before today, and re-seeding the neutral over it would
show his own screen agreeing with itself, which is the `TN-57` shape under a new name.

## ⚑ What replaced the missing default as the "not answered" signal

The column still has no default and the sheet still writes **solely on Save**, so **dismissing with
the X stores nothing** — and with a value seeded, that dismissal is the *only* remaining separator
between "not answered" and "about the same". A later change that wrote a row on close would erase
the distinction without touching the picker or the seed, so the e2e spec now asserts the dismissal
rather than only the control.

## Both tests were rewritten, neither deleted

`e2e/tn58-vs-yesterday-no-default.spec.ts` → **`e2e/tn58-vs-yesterday-neutral-default.spec.ts`**.
Its no-default assertion was wrong; the three properties beside it were not. It now proves the
control renders three options with **only the neutral** checked, that a retap reaches nothing
selected (the sole route to NULL from inside the sheet), and that a dismissal fires no
`POST /api/day-checkin`.

The unit test's first case inverted with it, and gained a second: the restore path is guarded
explicitly, because it is the one line the seed must not reach.

## Controls run, because a test that passes by observing nothing is a failure I have already had

- **Seed reverted to `null`** → the source guard goes red on the right assertion. It discriminates.
- **Dismissal swapped for a real Save** → the request listener recorded **1** POST. That is the one
  that mattered: `toHaveLength(0)` is worthless if the listener could never have seen a write. The
  row it wrote (`vs_yesterday = 'same'`) was deleted from the local dev database afterwards, and is
  also direct confirmation the seeded neutral reaches the column.

## Docs reconciled in the same PR

- **`LB-190` gained the clause `LB-191` owed it.** The boundary moved **twice** — the question
  changes (`OR-206`) *and* a neutral can now arrive unconsidered (this) — so rows divide into
  **three** eras, not two, and the middle one already exists and is accumulating. A stored
  question-version column covers all three; **a recorded cutover date covers only one of the two
  shifts**, which is a second argument for the column.
- **`OR-206`'s stale note** pointed at the old filename and said the spec asserts nothing-selected
  "until `LB-191` says otherwise". It has. Rewritten with the new name and the `GROUP` constant
  named as the one place its locator changes when the prompt does.
- **`LB-197` filed** (`Lane: O`, rank 61): *About the same* wraps to two lines at 384 px and is now
  the pre-selected pill every morning. Cosmetic, blocks nothing, and a **looks judgement** — so the
  owner's, not a lane's, and not `DV`'s either since there is nothing to measure.

## Verified

`npx tsc --noEmit` · `pnpm check:rules` **Ran 86 of 86** · the rewritten e2e spec **4 passed**
(2 tests × 2 projects) and the unit file **6 passed** · `check-backlog-pointers` **523 entries, OK**.
Rendered at **384 px dark, portrait** — the neutral carries the muted fill, the other two are plain.

## Not exercised

- **The S25.** Rendered in the Playwright harness, never on the device. No device gate is owed:
  nothing here touches safe-area, gestures, notifications or a native plugin, and the write path is
  byte-for-byte the one that already shipped — only its initial value changed.
- **The local-store write path.** `getLocalStore` returns null in the web sandbox, so the dismissal
  test proves no *API* write. The device writes through SQLite first, and that branch is reached by
  the same `handleSave` the dismissal never calls.
- **A second open in one session**, which the source guard asserts but no rendered test drives.

## Also in this PR: the post-merge CI read on #2023

#2023 merged green on all five required checks with **E2E shard 3 red**, and reading it anyway is
the habit that PR existed to establish. Four failures, and **neither of the two specs #2023 fixed
was among them** — those held.

- **`recommended-goal-values:28`** — already documented under `LB-56` as a spec that fails when
  sharded because the state it needs is created by a spec sharding took away. Known, not new.
- **`my-meals-artboard-parity:135`** — `browser.newContext: …has been closed`. `LB-149`, unchanged.
- **`meal-type-reassign:65`** — **0 radios where 6 expected, and it failed its automatic retry in
  the same run.** #2023's journal recorded this as "not reproduced" on one data point and declined
  to call it a flake; that was the right call and the second data point has now arrived. It is the
  same signature `LB-56` describes, so it went there as a third named casualty rather than into a
  new entry — the fix is that entry's (make the spec create its own state), not a separate bug.
