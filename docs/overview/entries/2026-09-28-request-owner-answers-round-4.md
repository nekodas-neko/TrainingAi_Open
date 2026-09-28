# 2026-09-28 — four more answers, and a write that now needs sequencing

**Branch:** `request/owner-answers-round-4` · Orchestrator

`Ask: owner` **8 → 6**. All four entries are re-laned to whoever builds them.

| Entry | Answer | Now |
|---|---|---|
| `OR-191` | **Apply 1,618 kcal** — the 09-14 recommendation was meant to land | Lane A |
| `LA-169` | **Prescribe reps only** on bodyweight movements | Lane A |
| `LA-172` | **Type from time AND from an explicit tag** | Lane A |
| `TN-82` | **Announce the estimate, correct in one tap** | Lane B |

## `LA-172` was wider than the option offered

Asked whether to derive a meal type from the suggested time *or* match by log window, he answered:
*"Give it a type by its time; as well as what its tagged with."* So both — the type resolves
**tag → derived-from-time → none**, with the time as the default and an explicit tag winning. That
keeps a wrong derivation visible and correctable rather than silently wrong, which is the failure
the window-matching option had.

## `OR-191` creates a sequencing hazard worth naming

Applying 1,618 is a write to his live nutrition targets. So is `LA-126`, where the device agent
accepts the post-`RV-66` recommendation — and `OR-201` says a computable target should not need a
tap at all. **Three things now want to set the same field.** Recorded on `OR-191`: do not apply the
number by hand *and* have DV accept a recommendation; whoever goes first states which number
landed. All of it follows the standing production policy — snapshot, affected rows against
prediction, stop on mismatch.

## `TN-82`'s cost is carried into the entry, not waved off

Announcing an estimate shows him the app's guess before he corrects it, which is the anchoring that
contaminated 62 days of `energy_level`. It does not vanish here — it **changes shape**: a correction
is a stronger signal than a rating because he only acts when the app is wrong, but silence then means
either *"right"* or *"never looked"*.

So the build must distinguish an explicit accept from an untouched default, using the `touched` flag
convention `sleepQualityFeel` already has (`TN-57`). Without it every unopened morning reads as
agreement, and the validation problem returns wearing this feature's clothes. Written into the entry
rather than left in this journal.

## `LA-169` will move a number he reads

23 of September's 49 unplanned sets are bodyweight, so adherence changes the day this ships. Named
on the entry: say so when the first figure moves, or it reads as a regression.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links`,
`check-backlog-pointers` — clean by exit code.
