## 2026-08-20 — the twelve latent fetch-once sites, judged; and the check's own count had drifted (Q-359)

**Branch:** `fix/fetch-once-baseline-comment` · comment and docs only, no runtime code changed.

Q-359's remaining scope was *"twelve latent sites, none urgent … judge any future addition by where
the component is mounted"* and *"some may never be worth converting"*. Judged, per site rather than
as a group, and the answer is that **none of them is worth converting on current evidence**:

- **`run-hr-zone-hero`, `run-active-screen`, `done-screen`, `live-hr-chart`** read `hr-profile` or an
  HR series while a run or workout is in progress or has just finished. Nothing writes those keys in
  that window, so a subscription would wait on a signal that never fires.
- **`my-meals-picker`** reads `saved-meals`. The only writer reachable from the flow it sits in is
  `meal-plan-setup-sheet`'s `invalidateSavedMeals()`, which runs at the **end** of the wizard — after
  `{step === 4 && <MyMealsPicker/>}` has unmounted it.
- The rest are route-level screens whose next mount refetches.

**The limit of that judgement is stated rather than buried.** For `my-meals-picker` it is "no writer
found reachable", not "proven unreachable" — whether `saved-meals-sheet` can be opened on top of the
wizard was not traced. Any site is worth re-judging the moment a new writer starts clearing its key
while it is on screen.

The judgement lives **in `scripts/check-fetch-once-effects.js`, beside the baseline map**, not only
in the backlog entry: that file is where a session looks when the check fires, and a reason recorded
somewhere else is a reason that gets re-derived.

**The check's own prose count had drifted, which is worth more than the fix.** It read *"13 sites
across 11 files"* against a baseline map holding **12 across 10** — a conversion removed a file and
left the sentence behind. This is the same class of error as the over-counting scanner documented
directly above it in the same file, and Q-359's own lesson is *"a scanner's own baseline is evidence,
and this one had never been checked against a hand count"*. The line now says to count off the map,
and notes that the run output prints computed totals for exactly this reason.

**Verification.** `node scripts/check-fetch-once-effects.js` — OK, 12 across 10, none new.
`pnpm check:rules` — Ran 50 of 50 Custom Rules steps, all passed.

**Not exercised:** nothing runtime. No component changed; the only code touched is a comment block.

---

## Also in this PR — the compaction sweep, because the directory crossed its runaway limit

`docs/overview/entries/` hit **61 foldable entries against a 60 limit** partway through this change,
which fails Custom Rules on **every open branch**, not only the one that notices. Same shape as the
2026-08-18 occurrence. It rides here because it is what unblocked this PR's own gate.

**59 unlinked entries folded** into `docs/overview/history-2026-08-18.md` (64 KB → ~250 KB, still
inside the ~250 KB per-file rule, so no new history file was needed), oldest first, and `git rm`'d.
Both rules the README says a sweep must follow were applied:

1. **Only unlinked entries were folded.** An entry cited by `projectOverview.md`, a domain index or
   another lane's baton stays loose so the citation keeps resolving — computed by checking every
   `.md` in the tree for the filename rather than by eye. 76 entries remain, all of them either cited
   or newer than the sweep.
2. **`](../../` was rewritten to `](../` in every folded body.** An entry sits one directory deeper
   than the history file, so every relative link inside it loses a level on the move. Missing this is
   what left six broken links on the first 2026-08-18 attempt.

Verified by the gate rather than by inspection: `pnpm check:rules` runs *No broken relative links in
docs* and it passes, 50 of 50.
