# 2026-09-24 — four owner decisions answered, and the clinical baseline leaves the public repo

**Branch:** `chore/or-159-owner-decisions` · **Lane:** O · docs + `scripts/private-paths.json`

The owner asked where things stood and what needed him. Four questions were put in one sitting, each
with a recommendation first, per **Decisions That Come Back To Me**. All four came back.

## What he decided

| | Decision |
|---|---|
| **Branch protection** | **Keep parked** — asked a second time, with the correctness framing rather than the throughput one. |
| **TN-64 — readiness gates nothing** | **Extend the recommender to `ai_dynamic` and persist ACWR**, keeping his confirmation step. |
| **RV-199 — three privacy items** | **Apply all three.** |
| **RV-113 — the tab-switch blink** | **Leave it.** |

## The clinical baseline is out of the tree

`docs/clinical-baseline-2026-08-27.md` held a DEXA, an RMR, a 58-analyte blood panel, the provider's
scan reference and the instrument serial — in one file, in a public repo. It is removed, registered
in `scripts/private-paths.json` under a new `personal-health` kind so CI refuses it back, and the
**nine** links to it are repointed to plain text. He was sent the file before it was deleted.

**A fact the recommendation had not accounted for, found by reading the document instead of the
entry describing it:** it called itself the *durable* copy, and `BF-2`, `BF-33` and `BF-1` were each
filed waiting on exactly these values, with BF-41's own rule requiring its schemas be written from
the real report. This was working data. That did not change the decision — it changed the execution,
from a silent delete to pointers that tell a future entry where the values went.

**Two things deliberately not done, both reversible by him:**
- **The derived figures stay** — the 28.5 % vs 25.3 % scale pair, RMR 1325 vs 1549, the Cunningham
  comparison. A figure in engineering prose is a different exposure from a panel with a scan
  reference, several entries reason from them, and they are in git history either way.
- **No history rewrite.** Declined inside the recommendation he accepted: irreversible, breaks every
  clone and open PR. **The data remains in public git history** — removing the file does not undo
  that, and the entry says so rather than implying a clean removal.

## Where the other three went

**TN-64** was `Lane: O` only because it needed his call on what the app should *do*. He made it, so
it re-laned to **A** the same hour, with the build split three ways: persist ACWR first (nothing
stores it, which is why half this entry's finding was inference), then widen the
`phaseMode === 'automatic'` condition, and keep `POST /api/confirm-early-deload` in the path — the
app proposes, he confirms. The entry now says explicitly **not** to move the 45 / 1.2 thresholds in
the same change, because then nobody can tell whether a prompt fired from the gate opening or the bar
moving.

**RV-113 was removed and then REINSTATED in the same PR, because the owner reversed it.** Asked
whether a blink was worth one line, he first said leave it. Told the reasoning — and told that the
blink's visibility had never actually been established — he answered: **"speed/performance/efficiency
when switching pages tabs is my highest priority. If this can fix speeds do it."**

**So it is built, and the entry now carries a warning against the claim he was sold it on: it removes
a BLANK, not a DELAY.** The 58–109 ms gap is the same frames as `DV-12`'s long task, and that task is
what costs the time. Dropping the opacity ramp shortens it by nothing; it paints the content during
the block instead of leaving the user on the background. Real perceived-latency win, zero throughput
win — and worth stating loudly, because the pass test (`perf.js longtasks`) will show **no
improvement** and someone will read that as failure.

**`DV-12` re-laned `DV → B` and moved to position 2, batched with RV-113.** That is the entry holding
the 68–118 ms, and **it was parked on a measurement that has since been taken**: its own *"Not
established"* asked for a CPU profile to name what dominates the task, and sweep 3 ran it — the canvas
`font` setter, 7–48 ms, under chart.js `update → _tickSize → _computeLabelSizes → set font`. Every tab
switch re-runs a chart.js update that re-measures axis labels. That is CLAUDE.md's trap (b) exactly,
*a probe already run is no longer DV's*, and the entry's own text already said to hand it back to B
with the profile attached. What is left — which chart — is a grep, not a phone.

**The two ship together.** Content painted promptly on top of a blocked main thread still reads as
sluggish; the pair is what he asked for.

**Branch protection was asked twice and parked twice.** What it costs is written onto `LB-52` so the
next session inherits the reasoning instead of re-deriving it: every merge stays hand-caught against
a base moving every ~8 minutes, and a green merge is still no evidence the checks passed. The
mitigation is a habit, not a mechanism. The entry now says **do not re-ask without a new fact.**

## One approval that was not an answer

RV-199's third item recommended *"exclude the cookie store, and decide on the ring key
deliberately."* Reading "all three" as approving a ring-key answer would have been putting words in
his mouth — he approved the decision being **taken**. So item ③ split: the cookie exclusion is
`OR-159` (Lane A, decided), and `OR-160` asks the ring-key question on its own, with the recommendation
to back it up encrypted. That one matters more than its size: an uninstall destroys the ring's BLE
key permanently, and a backup is the only thing between him and that. `OR-159` carries a warning not
to settle `OR-160` by implication while editing the same manifest.

## Verification

`pnpm check:rules` — **Ran 78 of 78**, all passed, including the broken-relative-links step that the
removal initially failed with four links in the backlog. `check-backlog-pointers` — OK, 489 entries,
no duplicates, no cycles.

No product code changed. Items ② (a GitHub account setting) and ③ (`android/**`) are not the
Orchestrator's to execute and are routed rather than done.
