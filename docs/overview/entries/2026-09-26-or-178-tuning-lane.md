# Tuning gets a lane, and two of the three guaranteed-conflict files stop existing

Orchestrator, 2026-09-26. `scripts/` tooling plus docs. Owner asked for the `O` lane to be cleared
and everything routed correctly.

## `Lane: T`, because a correct triage could not act on itself

Fifteen scoring entries owed a **Tuning proposal**, not the owner's signature. Three independent
sweeps (OR-117 on 09-16, OR-153 on 09-24, RV-189 after) each reached that conclusion, and none of
them could record it. Removing the wrong `Gate: owner` would have released the entries into Lane A's
READY list — and a scoring change with no proposal is exactly what Lane A must not pick up. So the
wrong field was also the only brake within reach.

The workaround was `Needs: OR-150` on all fifteen: a dependency on an entry whose whole content was
*"these need a lane that does not exist"*. It parked them for the right reason while stating a false
one.

`T` is now a lane value. `lane.js` matches it, `next-item.js` treats it as assigned-only (like `O`
and `DV`, so it never inherits the untagged), and `docs/agents/README.md` carries it in the table.
**A `T` entry names its implementation lane in prose** and Tuning re-lanes it to `A` or `B` when the
proposal exists — the lane keeps meaning *who acts next*.

`node scripts/next-item.js --lane T` prints **12 ready, 3 parked**. `OR-150` is removed: its
deliverable is now visible as the lane emptying, and each entry carries its own reason.

OR-150 itself deferred this — *"revisit only if these fifteen prove that a standing channel is needed
rather than one entry"*. Fifteen entries across three sweeps is that proof, and the deferral was
right to want it first.

## `docs/doc-size-baseline-history.md` stops being written by finishing PRs

LB-120 measured the three files that collide on every pair of concurrent PRs, the same three every
time across six resolve-and-push cycles on #1333. **Two are now gone:** the backlog's own `.size`
baseline (LA-129 reports rather than ratchets it), and this one — LB-130's fix, one note per change
under `docs/doc-size/history/`, the shape `docs/overview/entries/` already uses. The three reminder
messages in `check-doc-index-size.js` point there now; the 18,000-line batched file keeps every older
note and a compaction sweep folds the new ones in.

**The third is `docs/implementation-backlog.md` itself and it is irreducible** — two agents removing
two finished entries is a genuine concurrent edit, not an artefact of file layout. LB-120 is annotated
to say so: anything further proposed there needs a fresh measurement, because the cause it argued
from has been removed twice over.

This PR's own baseline raise (`CLAUDE.md` 1054 → 1056) wrote the first note under the new directory,
which is the cheapest possible proof the convention works.

## Cleared, and one thing found

- **`LB-134` removed** — closed by OR-164 on 09-25 with no residue, and still sitting in the queue.
- **`RV-143`'s tooling half is done** and now says so. `--sittings` consults the device gate and
  prints **BLOCKED ON A DEVICE CHECK (10)** ahead of the 109 owed looks. Only the triage is left.
- **`OR-139` gained its sixth instance**, and it is the best evidence it has: `BF-61` shipped a fix,
  the fix failed on the device, and the entry kept `Verify:` + `Keep:` — printing to Lane B as *not
  new work* while its own heading read *"the fix FAILED; open work"*. The entry contradicted itself
  in one screenful and the runner believed the field. Six hand-fixes is enough; the entry now names a
  narrow check that would have caught all six, keying on the three words the device protocol allows.

## Lane O after this

44 ready, 16 waiting on the owner — from 47 and 16. The reduction is small on purpose: most of what
is left is genuine Orchestrator work (docs reconciliation sweeps), not mis-routing. The routing was
already close to right; what was wrong was that Tuning had nowhere to be sent.

## Four owner decisions taken the same day

Put to him as one prompt, with a recommendation each. All four answered; entries re-laned and out of
`O`.

| entry | answer | now |
|---|---|---|
| `LB-141` walk exits | **Prompt on both** — he overrode the recommended silent save | Lane B |
| `LB-152` colour tokens | **Retune the token to today's hex first, then migrate** | Lane B |
| `LB-157` Home header | **Date on its own line**; battery chips stay, deliberately | Lane B |
| `BF-191` phantom rows | **DV may soft-delete the three named ids** next sitting | Lane DV |

Two are worth recording in more than a table. **`LB-141` went against the recommendation** — the
brief argued for a silent save on the ground that a wrong save costs one tap and a wrong discard is
permanent; he took the prompt anyway, so the entry says build the prompt and not to re-derive the
asymmetry argument. **`LB-157` closed an alternative as well as choosing one:** moving the battery
chips off Home was offered and declined, because he added them on purpose (Q-111), so that option is
struck rather than left open for the next reader to re-propose.

`BF-191`'s authorisation is for **three named row ids and nothing else** — a one-off, not a widening
of the device agent's standing write permissions.

Lane O's owner queue: **16 → 12**.
