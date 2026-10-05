# Backlog triage for the move to GitHub Issues (Phase 1)

**2026-10-05.** Phase 1 of the [release-train spec](2026-10-05-release-train-design.md). Every one of
the **524** entries in `docs/implementation-backlog.md` (as of `main` today) gets a default verdict,
recorded row by row in [`2026-10-05-backlog-triage.csv`](2026-10-05-backlog-triage.csv). **That CSV is
the input to the Phase 3 migration**: whatever it says when the migration runs is what gets
created. To change a verdict, edit the row or tell the Orchestrator.

The sort is mechanical, on purpose. It uses the repo's own parser and the exact bucketing
`next-item.js` uses, and its counts match that tool (READY 139 · KEEP 173 · PARKED 123 · VERIFY 49 ·
REFERENCE 36 · WAITING 3 · UNCLASSIFIED 1). Six verdicts were then overridden by hand, each with a
written reason in the CSV's `note` column.

## What the 524 become

| Verdict | Count | Becomes |
|---|---|---|
| `issue` | **124** | One issue each: 55 engine, 4 surface, 40 chore (mostly Lane O), 23 tuning proposals, 2 device follow-ups. 27 of the 124 are builds hiding in a `Keep:` |
| `issue-blocked` | **70** | One issue each, labelled `blocked`, with "Blocked by #N" (45 engine, 17 surface, 5 tuning, 3 chore) |
| `question` | **38** | `type: question` issues for you, each with the decision brief written. Listed below |
| `milestone-v2` | **2** | Q-1a and Q-1b, into the v2 bundled-shell milestone (spec §10) |
| `fold-device` | **148** | **12 device-check issues**, one per area: app-shell 34 · platform 24 · devices 24 · nutrition 16 · workouts 16 · readiness 12 · sleep 7 · body 7 · activity 4 · cardio 3 · heart-rate 1. The Implementer Agent works them in the release test |
| `fold-owner-look` | **4** | One "owner look" issue: things already shipped that you said you'd look at (OR-166, OR-158, BF-142, BF-126) |
| `fold-watch` | **88** | One **watch-list** issue. These are shipped entries whose residue is "confirm it later". The Orchestrator prunes it during the first release prep |
| `archive-reference` | **36** | Not work. They stay readable in the frozen archive |
| `archive-resolved` | **2** | OR-207 (the freeze settled it), LB-56 (the spec answered it) |
| `obsolete-process` | **12** | Maintenance of the process being retired: batons, lanes, queue tooling, sittings, journal windows. Listed below |

**Net: about 245 issues** (124 + 70 + 38 + 12 + 1 + 1, plus the 2 in v2), down from 524 entries.
The work list proper is **194** (124 + 70).

**37 of the work issues were filed before 2026-08-20** and carry `reverify = yes` in the CSV. They
get a `re-verify` label: the implementer checks the premise against `main` before building, which is
already the standing rule and matters most for these.

## The 38 owner questions (your friend's step 3)

These are everything the queue says is waiting on you. **Many are probably stale or already
answered.** In Phase 3 the Orchestrator writes each as a question issue with a recommendation. If an
entry has gone stale it closes it with the reason, rather than asking you.

| ID | Where it sits | The question |
|---|---|---|
| LA-180 | ready | your one calorie number: taken literally, it lands at 1,034 kcal today and 797 on a rest day |
| LA-185 | ready | how should the calorie ring show a meal the app ASSUMED you ate? |
| LA-178 | ready | two of your answers point opposite ways on the session-length estimate: fix the double-count, or leave it |
| LB-167 | ready | does the meal tile read as a failed image to you? (RV-212 ④) |
| PS-48 | ready | two owner questions that finish the collection v2 rules |
| PS-53 | ready | review the finished cat-collection designs, and decide what awards what |
| OR-172 | ready | the Oura BLE path is the OWNER'S setup, not a product feature |
| OR-173 | ready | the owner's storage principle vs the archive rule: computed on Railway, raw on the ring |
| OR-170 | parked | he wants "prescribed heart-health activity", not "prescribed run" |
| TN-84 | ready | the sleep announcement's wording is the owner's call; here is the draft to approve or edit |
| RV-161 | ready | five owner decisions the reads just made answerable |
| OR-145 | ready | the owner questions that are correctly gated and have never been asked |
| TN-70 | parked | `resilience_level` published two disjoint regimes: exclusively 5 for five weeks, then never 5 again |
| LA-173 | ask | five things Lane A needs from the owner (three merge yeses, a style, a key) |
| LB-172 | parked | Resting HR is drawn as a score, and neither proposed fix fits |
| BF-189 | ready | every exercise sits on the 2-set floor, and weekly volume lands at 66% of the owner's own targets |
| RV-65 | parked | the prescription asks a model for numbers that deterministic code then overwrites, and nothing measures w |
| TN-41 | parked | four raw tags are stored and never decoded, and one of them has no decoder at all |
| PS-41 | parked | normalize Health Connect's intraday HR series into `oura_heartrate` so Activity Score works for non-ring  |
| PS-44 | parked | compute nightly/readiness HRV from raw beat intervals instead of trusting the ring's own figure |
| PS-45 | parked | a per-user API key/token for external programmatic health-data ingestion |
| PS-46 | parked | build the Apple HealthKit connector (iOS) |
| LB-157 | parked | Home's header row cannot hold a date AND three chips at 412 dp: which reading moves? |
| TN-33 | parked | the stress storage defect is fixed and the SIGN is not; TN-22's reversal was an eight-day artefact |
| LA-95 | parked | the rest-discipline bars grade past sessions against today's prescription |
| PS-28 | parked | ACWR: an 8-day acute window, a 56-day unbanded chat tool, three baselining rules |
| LA-71 | parked | `scale_raw_samples` still has no unique key |
| PS-36 | parked | sex='other' silently halves VO2max, best pace has no distance floor, and WHO minutes have three mappings |
| BF-106 | parked | press the `VACUUM FULL` on `oura_raw_samples`; the packer freed the space and nothing returned it |
| TN-2 | parked | the Body Battery charge window has closed, so the tank only drains |
| LB-53 | parked | `oura_daily_derived`: what actually writes it, and the one thing still owed |
| Q-551 | parked | OWNER DECISION: stay on Railway or leave, once the D-track has shrunk the server |
| OR-115 | ask | the admin surface has accumulated buttons nobody uses |
| Q-513 | parked | the score-audit panel and the next-session engine disagree on the ACWR band on 38% of days |
| Q-250 | parked | an Android emulator job in CI, to close the 17 rows that need an Android runtime and nothing else |
| Q-51 | ready | the perf work is not aimed at the screen the owner actually uses |
| Q-49 | parked | public repo migration (Phase A: model delivery · Phase B: the cut) |
| Q-30 | parked | DB volume: finish the diagnosed fix, and resolve the O1 tension with D4's raw-drop-vs-bytea decision |

Already visible as stale, from this session alone: **PS-36**'s first two parts were fixed today by
OR-211 (#2043). **Q-49**'s public-repo cut has happened. **LA-173**'s merge yeses are partly spent
(#1849 merged today).

## The 12 marked obsolete

OR-195 (move Lane A local: done) · TN-80 (PRs tracked nowhere: GitHub does this now) · RV-157 and
RV-143 (device sittings and the `--sittings` view) · RV-156 and RV-158 (Known-Issues hygiene) · OR-136
(the 4-hourly routine's prompt) · LB-121, LB-120, LB-94 (queue-parser marker, backlog size baseline,
journal window) · PS-4 (batons) · PS-38 (a `CLAUDE.md` claims sweep, which Phase 4 replaces).

## How each verdict was derived

- **Bucket first**, exactly as `next-item.js` computes it, including a `Keep:`'s own gate.
- **WAITING** → question. **PARKED**: an owner gate → question; a device gate → device check; an
  unmet `Needs:` → blocked issue.
- **VERIFY**: `device` → device check; `owner` → owner look.
- **KEEP**, using the repo's `keep-kind` classifier: settled → archive; a check → device check; a
  build → issue; anything else → watch list.
- **READY**: DV → device check; T → tuning issue; A/B → issue. O → obsolete if the title is about the
  process being retired, a question if it reads as one, otherwise a chore issue.
- **REFERENCE** → archive.

The script that produced this lives with the Phase 3 migration, so the CSV can be regenerated right
before the move. The backlog will have drifted by then.
