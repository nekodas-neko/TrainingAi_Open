# BF-194 — owner questions get their own section, and the spec needed correcting first

**PR:** `chore/bf-194-owner-question-section` · **Lane:** O · queue tooling, no product code.

## The problem, as BF-194 measured it

CLAUDE.md says an owner question goes to `Lane: O` and gets "a queue position near the top".
`next-item.js` prints `TOP_N = 10`. **BF-189 and BF-191 were filed at ranks 1 and 2 one evening and
sat at 16 and 17 the next morning** — fourteen entries inserted above them in about eight hours. No
agent misbehaved: every agent files at the head, which is what the convention asks for, so the head
is exactly where the churn is. Position cannot hold a guarantee the queue's own traffic undoes daily.

## Its recommendation did not work, and that was measured before building

BF-194 proposed keying the new section on `Lane: O`, and rejected a field because *"`Lane: O`
already identifies them"*.

**Measured on `main` before writing any code: lane O holds 61 entries, 58 of them ungated.** It is
the Orchestrator's whole lane, not a queue of questions. A section on that key prints the lane —
which is what `--all` already does, and is the failure the section exists to fix.

So the field is back, because the premise that ruled it out is the thing the measurement refutes.
This is the repo's own *re-verify the plan against current `main`* rule doing its job; implementing
as written would have shipped a 58-row section.

## What shipped

- **`scripts/lib/ask.js`** — `- **Ask:** owner — <the question>`, bullet-anchored so prose cannot
  claim it, same argument `reference.js` makes about fields versus grepping.
- **The field does NOT park.** `Gate: owner` is the trap this rule already records: it removes an
  entry from the Orchestrator's own READY list, so gating a question on the owner is what stops
  anyone asking it. `Ask:` is pure visibility — an entry carrying it is more visible, never less,
  and it outranks `parked` in `bucketFor` so even a gated question stays seen.
- **A `WAITING ON THE OWNER` section**, printed above READY and outside the `TOP_N` cut.
- **Eight entries tagged:** `OR-145`, `RV-161`, `RV-157`, `RV-170`, `RV-121`, `BF-189`, `BF-191`,
  `BF-193`. `OR-150` is deliberately not among them — it waits on Tuning, not on him.
- **Validation** in `check-backlog-pointers.js`: `owner` is the only value, so a typo cannot silently
  drop an entry back into the ten-row cut.

## One divergence from `reference.js`, on purpose

`askFromLines` also accepts `- **Ask** — owner: …`, where the bold closes before the separator.
`referenceFromLines` misses that shape. A missed Reference prints an entry in the wrong section; a
missed Ask leaves an owner question invisible, which is the whole failure the field exists for.

## Verification

BF-194's own criterion, met: `node scripts/next-item.js --lane O` shows BF-189, BF-191 and BF-193
without `--all`, READY stays capped at 10 and still leads with what genuinely ranks first (`OR-150`).

10 unit tests on the field and the bucket ordering. Mutation-checked: `Ask: device` fails the check
and names the entry; restoring `owner` returns to green.

**Deliberately not done, following BF-194's own instruction:** the three entries were not re-ordered.
The fix is to make rank stop mattering.

## Not exercised

Queue tooling only — no product code, no device path, no runtime behaviour.
