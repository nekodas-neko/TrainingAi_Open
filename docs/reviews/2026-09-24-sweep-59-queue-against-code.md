# Review sweep 59 — the implementer queue re-read against code, and why production stopped deploying

**2026-09-24 · Review · docs only.** Lanes are shipping within hours of filing, so older queue
entries go stale fast. Four read-only agents re-read the **59 READY entries in Lanes A and B**
(leaving out those filed today) against `main`. Each got one verdict, with a commit, a file:line or a
production read as evidence. Along the way the sweep found that production was 22 merges behind, and
reproduced the cause locally.

## Verdicts

| verdict | count | entries |
|---|---:|---|
| DONE — remove | 5 | LB-123, LB-114, Q-272, Q-3b, Q-112 |
| WRONG as written | 2 | RV-77 (not duplicates; never ran), LA-110 (build the cause, not the title) |
| READY but not startable | 7 | DV-14, LA-134, OR-137, TN-11, Q-28, TN-10 (now `Needs: TN-5`), Q-507 (now `Needs: TN-33`) |
| PARTLY DONE | 4 | RV-38, TN-37, RV-99, TN-53 |
| VALID, lines moved or a step missing | 17 | including BF-15 (a new site), RV-78 (the naive `Promise.all` is wrong), RV-101 (the key must render in compact mode), BF-165 (its header line is stale) |
| VALID as written | 24 | |

Each non-trivial verdict is a dated `🔎 Re-read` note on its entry. Removals, parkings and
reroutes are **RV-189** for the Orchestrator.

**Costliest to have built as written:**
- **LA-134**: the constants fitted to a dose ramp-up.
- **OR-138**: it widens the auth surface while an existing `set_config` pivot stays open. That was
  found from source and **deliberately not probed on production**.
- **LA-110**: a rule that hides a data defect.
- **BF-165**: redoing a harness investigation it already concluded.
- **Q-272**: re-tuning a battery rebalanced that day.

## Production is not deploying: DV-14, reproduced

`/api/version` reads **1.465.26** while `main` is at **1.465.31**. Tonight's fixes, including
RV-180's (#1554) and RV-164's (#1546), are merged and not live. Lane A had found the reason hours
earlier: 39 of 40 Railway builds run out of heap. The leading suspect was the 661 KB changelog.
This sweep tested it:

| run (sandbox, 15 GB, Node 22) | result |
|---|---|
| default heap | passes; `next build` peaks at 7.85 GB RSS |
| source maps on (dummy token, no upload) | passes — no difference |
| 3 GB heap cap | **fails exactly like Railway**: `JsonStringify`, exit 134, ~94 s |
| 3 GB + changelog cut to 9.8 KB | **still fails** — not the changelog |
| 3 GB + Sentry wrapper removed | **compile passes**; then type-check OOMs under the same cap |

**RV-188 now heads Lane A.**
- Unblock: set the heap in the build script. It is structural and reversible, and needs no owner
  decision.
- Then take the build off the boundary: trim the Sentry webpack wrapper, and stop Railway re-running
  lint and type-check, which CI already runs.
- Done when it passes the now-deterministic local check at a 3 GB cap.

## Also noted

- Two hypotheses were tested this session and **refuted** before being filed: source maps and the
  changelog.
- RV-146 and RV-163 from earlier sweeps already shipped (#1548 and the fonts PR). They are not live
  until RV-188 lands.
