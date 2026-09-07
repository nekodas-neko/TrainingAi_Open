# 2026-09-06 — a third lane value, `O`, for work in neither implementer lane (OR-103)

**Branch:** `chore/or-103-orchestrator-lane` · docs + queue tooling · no product code.

## What was wrong

Five backlog entries printed as UNCLASSIFIED to both implementer lanes, permanently. Four of them —
**LB-52, LB-54, LB-55, LB-56** — carried `Lane: ? — neither lane`, and they were right: CI
configuration, `playwright.config.ts` and repository rulesets sit in neither Lane A's paths
(`lib/data/**`, `app/api/**`, `packages/shared/**`) nor Lane B's (`app/**`, `components/**`), so the
path rule in `docs/agents/README.md` §3 has no answer to give. `?` was standing in for two different
states — *"nobody has decided"* and *"the decision is that it belongs to neither"* — and only the
first is fixable by tagging.

That is the same defect `scripts/lib/lane.js` exists to fix: a lane that lives in prose rather than
in the field. The consistent repair is a third value, not a special case.

## What changed

- `scripts/lib/lane.js` — `LANE_FIELD_RE` / `LANE_LOOSE_RE` accept `O`. `O\b` cannot match the word
  *Orchestrator* (no boundary after the `O`), which a test pins.
- `scripts/check-backlog-pointers.js` — the same widening, so an `O` tag is not read as untagged.
- `scripts/next-item.js` — **unchanged.** Its `wantLane` already hides a lane that is not the one
  asked for and always shows an unstated one, so `O` fell out correctly with no edit.
- `scripts/__tests__/backlog-lane-resolution.test.ts` — three cases (field form, bare form, and the
  *Orchestrator*-prefix trap). 12 passing.
- `docs/implementation-backlog.md` — LB-52/54/55/56 → `Lane: O`; **LB-46 → `Lane: A`** (its one
  latent issue is in `reevaluate.ts`, which is Lane A's file, so it was genuinely mis-tagged rather
  than lane-less). `Lane: O` documented in the field-rules block.
- `docs/agents/README.md` — the O lane documented beside the `Gate:` rules.

## Result

UNCLASSIFIED went **5 → 1**. The remaining one is **PS-4**, which documents itself as permanently
unclassified and is correct to be. `--lane O` lists LB-56, PS-38 and LB-54 as READY; LB-55 prints
under REFERENCE and LB-52 is PARKED on `Gate: owner`. `check-backlog-pointers` clean on 318 entries;
`pnpm check:rules` **Ran 68 of 68**.

## Not done

The four `O` entries are now *visible*; none of them was worked. LB-56 (E2E gates nothing yet) is the
top of that lane and is the Orchestrator's own next piece of queue work.

**Surfaces not exercised:** none apply — this touches no runtime code, no device path, no schema.

## Also in this PR — OR-104, filed from a live production read

Checking the `Retatrutide` row (the owner asked for its free-text dose to be fixed) showed the
definition carrying `default_amount 0.5 · unit mg` **and** free-text `dose '10mg'` — the vial
strength, typed into a field labelled `Dose`. The 2026-09-07 log has already frozen both:
`amount 0.5, unit mg, dose_text '10mg'`, a 20× disagreement inside one row.

It is invisible because `supplementSubtitle()` falls back to the free text **last**, so with
`defaultAmount` set every list reads `0.5 mg today` correctly while the archive is wrong. The edit
sheet offers both fields with nothing reconciling them (`manage-supplements-sheet.tsx:30`), which is
why it will recur. Filed as **OR-104**, Lane A (engine stamping first, sheet after), directly behind
the reta tracker entries — OR-102a/b read dose history, and would inherit this.

**The live row is `Gate: owner`:** production is read-only from a session, and BF-3's stamp is
deliberate, so neither an agent nor a definition edit can repair the log already written.
