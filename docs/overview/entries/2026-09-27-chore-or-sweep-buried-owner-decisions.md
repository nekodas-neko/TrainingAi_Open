# 2026-09-27 — the BF-202 sweep: 70 was an upper bound, and the real finding was a routing defect

**Branch:** `chore/or-sweep-buried-owner-decisions` · Orchestrator

`BF-202` estimated **up to 70** owner decisions buried inside `Lane: A`/`B` entry bodies, where the
routing field cannot see them, and said plainly that 70 was a keyword match rather than a finding —
*"the work is separating those"*. This is the first pass.

## What the measurement said

Via `parseEntries`, not a grep over the file: **422** Lane A/B entries carry no `Ask:`; **54** of
those contain owner-decision language; **13** of the 54 already carry `Gate: owner`. Read
individually they fall into four groups, and only one is what the entry was filed about.

## ① Already decided — no action

`TN-64`, `OR-138`, `PS-17`, `Q-407`, `BF-81` all say *"the owner's call"* about a call he has since
made and which the entry itself records. A keyword scan cannot separate these from a live question.
This is most of why 70 was never a finding.

## ② Stale — the answer exists and the entry does not know

- **`RV-165`** said re-deriving scale composition at 158 cm was his call. `RV-170` **authorised it**
  on 2026-09-24 as a limb-(a) recompute-from-stored-inputs.
- **`Q-298`** said repairing the zero one-rep-max rows was his call. `RV-170` **answered it** as a
  limb-(b) hand-edit — do not rewrite, mark known-bad — and corrected the count to **15, not 10**
  (the 08-09 and 08-16 Pull clusters sat on deload sessions).

Both now carry the answer. Left alone, each would have been re-asked.

## ③ The real finding: entries routed by a sentence rather than a field

**`Q-422` has no `Lane:` field at all.** `parseEntries` was reading `A` out of the prose *"Tuning
proposes and the owner signs off; Lane A implements"* — a routing decision made by a phrase nobody
wrote as a field. This is the same class as the `Lane: DV` slip earlier today, and as the `Lane: T`
incident CLAUDE.md already records, hit a third time.

**`RV-38` had a real field and the same prose**, and `check-backlog-pointers` refused the push when a
second field was added — *"a re-laning that adds a field and leaves the old one standing is routed by
the stale value and nothing says so"*. That check earned its place: my bullet claimed the entry had
no field, which was false. Its `Lane: B` half had already shipped; the old field is demoted to prose
and kept, because it records which half.

**Five entries re-laned to `T`** — `Q-422`, `RV-38`, `Q-306`, `Q-420`, `LA-121`. Each is a scoring
change, and `Lane: T` (OR-178) is the field that says a Tuning proposal is owed before anyone builds.

**`TN-22` is the same class inverted.** It states it *"carries `Gate: owner` … so it parks honestly"*
and carries no `Gate:` field — so it claims to park and sits READY in Lane A. Flagged on the entry
and deliberately **not** "fixed": adding the gate would hide it rather than resolve it, and which of
those is right depends on whether the decision is still live.

## ④ Genuinely live and still buried

The output of the sweep, recorded on `BF-202` for the next owner round: hiding the readiness score
until the check-in is saved (`TN-67`, `TN-50`); whether a guided or treadmill walk counts as doing a
prescribed run (`RV-166`); making E2E a required check (`LB-149`, `Q-297`); the destructive-migration
group's single yes (`BF-144`, `LA-71`, `LB-42`); the `event_name` drop (`Q-540`); a second Railway
service (`Q-251`, money); the collection tier mapping (`PS-51`); the wallpaper tint default
(`BF-145`, `BF-139`, `BF-96`); removing an HTTP surface (`LA-89`); the scanner choice (`LB-38`); the
84-day re-derive (`TN-72`, `TN-74`); and one plain factual question — was *Start Again* pressed
before the back press (`BF-168`).

## One entry states something false

**`LB-13`** says *"Correcting the rule needs the owner (CLAUDE.md is not an implementer's to edit)."*
The Orchestrator owns the docs and edits `CLAUDE.md` routinely; the owner's carve-out is data, money,
auth and scoring, not documentation. Flagged on `BF-202` so it is not acted on.

## Not done

Group ④ is a list, not yet entries. Splitting each into its own `Lane: O` is the second pass, and
`LA-122` already tracks six of Lane A's — reconcile rather than duplicate.

**Not exercised:** documentation only. Gates: `Ran 83 of 83` Custom Rules, `check-doc-links` and
`check-backlog-pointers` clean, all by exit code.
