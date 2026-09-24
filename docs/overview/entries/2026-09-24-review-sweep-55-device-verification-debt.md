# 2026-09-24 — Review sweep 55: 155 device checks that no queue shows the device agent

**Branch:** `review/dv-verification-debt` · **Agent:** Review · **Docs only.**

The owner asked what else the device agent could check. The agent works from `next-item.js`, which
reads only the backlog. This sweep looked everywhere else an owed device check can live. Six
read-only agents triaged the rows, one chunk each; production reads were run here. Full result:
`docs/reviews/2026-09-24-sweep-55-device-verification-debt.md`.

## Found

- **155 `projectOverview.md` Known-Issues rows say "NOT device-verified" and have no backlog
  entry.**
  - About 60 are checks the phone alone can run. They are filed as **RV-155**, six stations in
    Lane DV.
  - About 55 need the owner. They are grouped into six sittings as **RV-157**, Lane O.
  - About 30 are already answered, or state something no longer true. They are **RV-156**, Lane O.
- **`docs/device-verification-queue.md` holds 5 live rows of 41.** Nothing points DV at it. RV-156
  retires it, and its live rows move into RV-155, RV-157 and RV-131.
- **Seven backlog entries were misfiled behind the device gate.**
  - LB-129, BF-49, Q-104 and BF-11 are shipped work owed a look, so they now carry
    `Verify: device`.
  - BF-22 is a diagnosis DV was already carrying, so it now carries `Lane: DV`.
  - Q-51's gate was answered by sweep 1, so it now carries `Lane: O`: close it or move it down.
  - LA-36 is unbuilt work, and its gate had parked it behind a check that can only happen after it
    ships, so the gate is removed.
- **Q-270's owed read, asked for on 2026-09-04 and never run:** `training_load_gate =
  'insufficient_met'` on **20 of 20** days. The OTS route is called and refuses every day, which
  contradicts the entry's own 08-30 finding that the MET gate clears by midday. The result is
  recorded on the entry, and the next step is Lane A's.
- **Production reads closed five rows:**
  - bodyweight `planned_pct` is null on 0 of 38 sets;
  - bodyweight volume is positive on 19 of 19 exercise logs;
  - `activity_score` is present on 31 of 31 days;
  - BDI is present on 31 of 31 days;
  - `prep_time_sec` is present on 104 of 104 exercise logs.
  `chronic_stress_score` has never had a value (129 days); Q-525 already tracks that.

## Why, and the guard

Writing "NOT device-verified" in a Known-Issues row was how a device check was owed while the
owner was the one running them. The device agent replaced the runner, not the list, so the list
went dark. **RV-158** proposes a CI check on new rows of that shape, the way RV-143 closed the
gated-entry gap.

## Not done

- No device run and no product code.
- `projectOverview.md` is untouched. Moving rows is RV-156's, and the Orchestrator's.
