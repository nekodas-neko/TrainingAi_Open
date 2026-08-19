# 2026-08-19 — Every Activity Score contributor measured; Q-277 answered (Q-524)

**Agent:** Tuning 🎶 · **Branch:** `tuning/activity-contributor-audit` · **Docs-only.**

Q-522/Q-523 measured two of the Activity Score's six contributors. This finishes the other four, and
in doing so answers **Q-277** — *"v2 fixed the mechanism Q-137 blamed and the outcome did not move."*

## The answer to Q-277

It **did** move — stored `activity_score` sd went **5.0 → 7.4** across the 2026-08-11 goal change,
range 66–81 → 64–91. Two qualifications kept on the record: **n = 8** post-fix, and history is **not**
back-filled, so 15 of 23 stored days are still scored under the old goals. The same trap the sleep
recalibration hit — the shipped improvement is invisible in stored history.

It did not move *much* because, after every fix so far, **about half the score's effective weight
still cannot vary**:

| contributor | weight | sd | at ceiling | verdict |
|---|---|---|---|---|
| steps | 18 | **33.4** | 16/90 | ✅ best in the score |
| strengthVolume | 20 | **23.8** | 32/88 | ✅ Q-190's fix delivered |
| strengthFreq | 25 | 13.1 | **69/88 (78%)** | 🟡 compressed **by design** |
| moveHours | 12 | — | **48/59** | ❌ saturated (Q-522) |
| zoneMinutes | 10 | — | **53/59 at zero** | ❌ floored (Q-523) |
| activeEnergy | 15 | — | — | ❌ absent 43/51 days (Q-521) |

With `activeEnergy` absent and `zoneMinutes` suppressed on strength days, the weights renormalise
over 75 → **strengthFreq 33%, strengthVolume 27%, steps 24%, moveHours 16%**. So **51% of effective
weight is informative, 49% is not, and the largest single effective weight is one of the inert ones.**
Reconstructing the composite predicts a ceiling of sd ≈ 10.2 under current goals (steps and
strengthVolume are independent: r = −0.016). Sleep replays at 16.6, Body Battery measures 29.6.

## The finding I deliberately did NOT file

`strengthFreq`'s 78%-at-ceiling looks like the obvious next fix — raise the goal, or extend the
curve past ratio 1.0. **Neither should be done.** `daily-goals.ts` sets the goal *at* the owner's
measured typical on purpose: more sessions is not monotonically better, the ACWR taper already
handles over-reach, and *"a goal of 6 would have one part of the model rewarding what another
punishes."* That reasoning holds, so this is a **constraint on Q-505, not a defect for it to
remove** — filing it as a finding would have been manufacturing one.

## Filed: Q-524 — two step goals

Found while auditing the `steps` contributor. `users.steps_goal` is **7,000** (the owner set it) and
drives the Goals Progress card and the daily digest's *"Steps: N/7000 today"*. `getDailyGoals()`
ignores that column and derives **10,000** from `activity_level = 'moderate'`, driving the Activity
Score, the Activity screen's own progress bar, `cardio-week`'s weekly target and the AI
health-insight prompt. On a 7,200-step day one screen says the goal is met and another reads 72%.

The sharper half: `daily-goals.ts` cites Paluch 2022 (benefit plateaus ~7–8k/day) and sets
`DEFAULT_STEP_GOAL = 8000` accordingly, but the *personalised* path returns 10,000 — so **the
fallback used when the profile is empty is better calibrated than the personalised value that
replaces it.** Measured: 10,000 reached on 16 of 90 days (18%), the owner's 7,000 on 31 of 90 (34%).

Left as an owner decision with three coherent answers written out, because whichever wins changes a
number they see daily.

## Backlog hygiene

**Q-277 removed.** Its "first action" was to dump the per-component parts and count each lane's
realised range — that is this audit. Its untested hypothesis (renormalisation collapses the score
onto saturating lanes) is confirmed, with the correction that `steps` and `strengthVolume` do *not*
saturate. Investigation finished; remedy lives in Q-505 and Q-521/522/523. Same disposition Q-277
itself prescribed for Q-137. Three references elsewhere in the backlog and one in `projectOverview.md`
were repointed rather than left dangling.

## Files

- `docs/reviews/2026-08-19-activity-contributor-audit.md` (new)
- `docs/implementation-backlog.md` — Q-524 filed; Q-505 amended with the audit table, the
  `strengthFreq` constraint and the stored-history caveat; Q-277 removed and its references repointed
- `projectOverview.md` — the comprehensive review's Q-277 line now states the answer
- `docs/domains/activity/README.md`
- `scripts/check-doc-index-size.js` — backlog **ratchets down** 10759 → 10752; projectOverview 7930 → 7933
- `docs/agents/state/tuning.md`

## Not exercised

Docs-only; no code path changed. Sub-scores are **reconstructed** from stored inputs using the
shipped formulas, not read from the app — `oura_daily_derived.activity_contributors` stores only
`{base, adjustment, trained}`, so the per-contributor breakdown is not persisted anywhere and had to
be derived. All measurement is `claude_ro`, **row-scoped to the owner**: n = 88–90 days, one athlete,
one activity level (the map's other tiers are unmeasured).
