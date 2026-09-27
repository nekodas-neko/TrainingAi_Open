# Forty-two entries said they were waiting on the owner; nine were not

Orchestrator, 2026-09-26. Docs only. First pass at the Orchestrator's primary job — the owner-gated
queue — aimed at the 42 entries parked in **Lane A** carrying `Gate: owner`.

## The shape of the problem

Fifty-one entries carry `Gate: owner`. **Forty-two of them sit in Lane A, where the Orchestrator never
sees them** — the lane field is what routes an entry, so a decision inside a Lane A body is invisible
to the one role whose job is putting decisions to him. **Not one of the 42 carried an `Ask:`**, which
is the field that makes a question visible. They had been waiting without being asked.

## Five were owner TASKS, not decisions — and being gated is what hid them

Each says so in its own gate text, and each now carries an `Ask: owner` naming the action:

| entry | what he actually owes |
|---|---|
| `LA-126` | one tap — accept the post-RV-66 calorie recommendation |
| `Q-4` | one night wearing the Polar H10; he said yes on 2026-08-04 |
| `BF-137` | one date — when the current GLP-1 vial started |
| `LA-65` | lived feedback after several sessions under BF-128's five exercises |
| `Q-222` | confirm or reject auto-detected activities, so the classifier has real labels |

`Gate:` parks; `Ask:` surfaces and blocks nothing. An entry can hold both, and the runner shows it in
WAITING ON THE OWNER regardless of rank. **The convention this establishes:** `Ask: owner` is for
anything where the owner is the next actor, decision or task — the body says which.

## Four were not his at all

- **`Q-31` was a fact, not a decision.** It asked *"is the implementation startable now, or does it
  still follow Q-1 and Q-30?"* The plan says it stays blocked behind both, and **both are still in
  this queue**. Replaced with two `Needs:` pointers, which park correctly and unpark by themselves.
- **`Q-547`'s field contradicted its own sentence** — it described itself as *"a READING, not a
  decision … do not present this to the owner"* while sitting in the field that makes every sweep
  present it as his. `Needs: Q-551` was the real park all along.
- **`LA-85` waits on the world.** It needs one live `calendar.events.insert` failure captured from the
  device, and nobody can make Google fail on demand — the owner least of all. It should be picked up
  opportunistically from `error_events`, not waited for.
- **`Q-297`'s owner half was answered on 2026-09-24** (E2E stays off the required-check list) and the
  field never came out.

## Two structural calls taken

**`Q-297` residue 1 — build the warmed-server instant-paint budget.** The gate called it *"a judgement
about spending CI flakiness"*, and that judgement has an answer now: **E2E is not a required check**,
so a flakier E2E cannot block a merge. Reversal is deleting the warm-up pass.

**`Q-220` — move the Known Issues tables into `docs/overview/known-issues.md`** and leave
`projectOverview.md` as the lean index it claims to be. Per-pillar files were the obvious alternative
and are where this entry's own multi-tag risk bites: an issue tagged `[sleep][platform]` must live in
one file and go missing from the other. One file keeps `grep -n '^### .*\[sleep\]'` working, which is
the property the standing rule depends on. **The cost this entry was filed about has grown while it
sat gated** — 8,068 lines measured then, **12,935 today**, paid by every session before its first
useful action. Reversal is one `git mv`. Re-laned to `O`: it is a docs sweep, not engine code.

## One is genuinely his and now has a question attached

**`LA-61`** — registration stores a lowercased email while three Google-path lookups pass the raw
provider value, so a provider returning different casing **creates a second account** and the first
keeps its data. Recommendation written into the entry: normalise on the way in *and* add a
`lower(email)` unique functional index, in one migration that first checks for rows differing only by
case. It stays his because it is auth.

## Where this leaves it

`Gate: owner` **51 → 46**, of which **37 in Lane A**. `Ask: owner` **13 → 21**, so eight questions and
tasks that existed silently are now in the list he reads.

**Thirty-seven to go**, and the pattern so far holds: read the gate's own text first — a third of them
say outright that they are not decisions.
