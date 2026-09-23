# 2026-09-23 — OR-136: the three gates with no reason, and a gate that blocked its own lane

**Branch:** `chore/or-136-device-gate-reasons` · **Lane:** O · queue state only

`--lane DV` goes **9 READY → 11 READY, 0 PARKED.** Three entries carried a device gate with no
reason after it; none of the three turned out to mean the same thing.

## The three

**`Q-168` — the reason was written, just not beside the field.** Its own *What is actually left*
section says it plainly: `/coach` and `/coach/confirm/[toolCallId]` are navless full-screen routes
with bottom-anchored controls, the shape that has regressed 11+ times, and the AI Coach section of
the smoke checklist is what settles it. **Reassigned from `B` to `DV`** — that check is one the
phone answers, because a bottom-anchored control either clears the gesture bar or it does not and a
safe-area inset is a number rather than a matter of taste. The cardio-goals half was dropped rather
than built, so nothing waits on Lane B. A FAILED result goes back to B with what reproduces it.

**`Q-7b` — the gate was simply wrong.** Nothing in it is a question the phone answers: ten
`oura_daily_derived` columns have no producer, which is engine work, and the producer they wait for
is the on-device rollup — `Q-545`'s build. Recorded as a dependency on Q-545 instead of a gate
nobody could discharge.

**`PS-12` — already answered.** OR-135 had written its reason the day before (it waits on the Colmi
R09, not the S25). The flag was stale.

## The shape that kept appearing: a gate naming its own lane

Removing Q-168's gate surfaced `DV-8` sitting under PARKED with `Lane: DV` and `Gate: device` — the
device agent's own work, hidden from the device agent by a gate naming the device agent. **A gate
names what someone ELSE must do first. When the lane and the gate name the same actor there is
nothing to wait for**, and the entry is simply that actor's work.

Filed by the device agent itself, which is how easily this hides. Q-168 acquired the same shape the
moment it moved to DV, and removing it there was the fix rather than a second thought.

## And then a decorative glyph parked it

With the gate off, Q-168 moved to **UNMIGRATED MARKER**. Its line opened `⛔ Device verification —
the blocking one`, and the queue parser reads that glyph followed by *block* within forty characters
as a real marker. The glyph was decorative; *"the blocking one"* was prose.

That is **`TN-59`'s class caught live** — an entry parked by a prose marker alone, invisible to
everyone. Reworded rather than left: say what blocks in words, keep the glyph for a field.

## Worth carrying

Three entries, one symptom, three different causes: a reason written in the wrong place, a gate that
was factually wrong, and a flag that was already stale. **Bulk-releasing them on the assumption they
were all circular would have been wrong twice**, and OR-134 said so when it declined to guess. That
restraint is what this entry spent.

## The same test broke again, for the same underlying reason

`next-item-visible-silence.test.ts` failed a second time in two passes. This morning it asserted the
DV output *"does not contain `showing`"* and went red when `RV-128` — *"does the tab switch drop a
frame **showing** neither panel?"* — entered the lane. I fixed that by matching the truncation
line's shape, **and left the other half of the mistake in place**: it still used DV as its
everything-fits case, hard-wiring the fact that DV was small. Today DV reached 11 and it went red
again.

Both failures are one error: **the test encoded a fact about the data rather than the behaviour.**
It now asserts the invariant across every lane — the truncation line appears if and only if the cap
hid something, and its total matches that lane's READY count. **A test that names a lane is a test
that expires.**

## The finding I was about to file already existed

Q-7b's body carries a paragraph reading *"New detail worth chasing separately: `/api/training-stress`
does compute and persist an OTS, yet `training_load_ots` is empty across the entire history"*. It
reads as an unfiled finding, and the No-orphaned-findings rule says an unfiled finding is a dropped
one — so the plan was to open an entry for it.

**It is `Q-270`, and Q-270 is far past that note.** 🔴, re-measured **0 of 104 days** on 2026-08-30,
with all four gates ruled out individually *and* the MET gate shown to clear by ~12:07 local rather
than late evening. A new entry would have been a worse duplicate of a well-developed one.

**The only thing that stopped it was grepping the column name before writing.** Q-7b now points at
Q-270 outright, so the next reader does not make the same move. **A paragraph that reads like an
orphan is not evidence of one** — the rule says file what is unfiled, not file what looks unfiled.

## The prose-marker scan (TN-59), run but not acted on

Scanning for the shape OR-136 caught live — the block glyph followed by *block* within forty
characters — returns **5 entries**: `RV-99`, `Q-538`, `Q-1b`, `Q-34`, `PS-7`.

They are **not one class**, which is why the first pass stopped at the scan.

**⚠ That scan was wrong in two places, and re-running it before acting is what caught it.** It named
five entries; the regex actually matches **seven locations, five of them queue entries**, and the
membership differs. `PS-7` is **not** among them — the fifth is the `▶ Oura on-device models
program`, whose *"activity detection (P3) ⛔ blocked — needs daytime raw motion"* is a genuine
block. Two further hits are in the `## Protocol` and `## Queue` prose, where the marker is being
**documented** rather than used, and must stay.

**More importantly, the remedy count was wrong.** Only **one** of the five was actually parked *by
the marker*: `Q-538`, `Q-1b` and `Q-34` each already carry a real `Gate:`/`Needs:`, so the tool
never reported their glyph at all, and their prose is honest — `Q-538` and `Q-34` genuinely are
blocked, and `Q-1b` is parked twice over (`Gate: owner`, plus a genuine marker further down; its
meta mention is an accurate description, not a defect). **None of those three needed an edit.**

The earlier reading came from `grep -B2`, which showed a `Gate: device` belonging to the *preceding*
entry as though it were `RV-99`'s. Reading one entry's own output settled it.

## TN-59, built

`RV-99` was **a false park**: its only reason was *"⛔ The blocking hazard was NOT the one the entry
named"* — a **correction** recording that the hazard the entry had originally named was the wrong
one, which is the opposite of a reason not to build it. No `Gate:`, no `Needs:`. It had been
startable the whole time, sitting in Lane B's PARKED list. Reworded to *"The real hazard"*; Lane B's
READY went **23 → 24**.

One entry is not worth a check on its own. What is, is that the shape regenerates: line 23892 of the
backlog already predicted *"[the entry drops] under UNMIGRATED MARKER the moment its gate came
off"* — which is exactly what `Q-538`, `Q-1b` and `Q-34` will do, since each is held today only by a
gate that will one day clear. So the check earns its place on the three entries that are **currently
passing**, not on the one that failed.

- **`scripts/lib/backlog-entries.js`** — the queue parser, extracted from `next-item.js`. The tool's
  own comments make this argument: `lane.js`, `keep.js`, `reference.js` and `queue-buckets.js` were
  each pulled out to be testable, and the same file records the lane rule being briefly
  re-implemented inline and drifting within a day. A second copy of the `⛔ block…` regex would fail
  more quietly still — an entry parked in one reader and ready in the other.
- **`scripts/check-prose-parked-entries.js`** — fails on an entry parked by the prose marker with no
  `Gate:` and no unmet `Needs:`. **Baselined at zero**, the strongest baseline a shrink-only check
  can have. It reports the *shape* and refuses to guess which kind of marker it is reading — TN-59's
  own load-bearing caution, and the reason the bare-glyph rule was retired at a 75% false-positive
  rate. Wired into Custom Rules: **Ran 77 of 77**.
- **8 tests**, against synthetic queues, because the real backlog is at zero and therefore cannot
  exercise a single judgement the check makes. The offender rule lives in the lib and is *imported*
  by both the check and its tests — the first draft restated it in the test, which is the drift the
  extraction existed to prevent.
- Verified by reverting `RV-99`'s wording and watching the check fail with that entry named, then
  restoring it. A check never observed failing is not a check.

## The goals-route flake — occurrence six, and the first hard evidence

`strict-schema-inert.test.ts` failed again mid-gate, reporting
*"`app/api/user/goals/route.ts` has 1 non-strict request schema(s) and is not in the baseline"*. Run
directly, seconds later, the same check printed **OK — 38 non-strict across 24 files (baseline
held)**.

**Why five occurrences produced nothing.** `execFileSync` returns stdout on success, but on a
non-zero exit it throws an error carrying only the command and stderr — `err.stdout` is a separate
property, and the test printed the error. The base-ref helpers warn on **stdout** by design, so if a
warning had fired it would have been discarded. *"No warning fired"* was used as evidence in three
of the five diagnoses, against a stream nothing was reading. This is the second time in two days
that this property of `execFileSync` has produced a false finding.

`run()` now re-throws with **both** streams labelled. It fired on this run — and the result
**refuted the hypothesis it was added to confirm**:

> **stdout was empty.** No base-ref warning at all.

That eliminates the leading theory. `resolveBaseRef()` returning null warns; `fileAtBase` exhausting
its retries on an unreadable read warns. Neither happened, so the base ref resolved and was read
cleanly. What reached `verdict()` was therefore either **the file reported absent at base** or **a
base count of 0** — and `verdict()` collapses absent, zero and a real number into one word, which is
precisely why six occurrences could not be told apart.

So the check now **reports what it saw**: `(base origin/main: 2 non-strict)` or `(base …: file
absent)` on every failure. Measured immediately after, on a quiet tree: base ref `origin/main`,
file present at 3,870 bytes, byte-identical to the working copy, check green.

**Still undiagnosed, and the trigger is still unconfirmed.** What changed is that occurrence seven
cannot be ambiguous: it will name the base ref and the count that produced the verdict. Two
hypotheses remain open and the evidence does not yet separate them — a concurrent `git fetch` from
another agent moving `origin/main` mid-run, or a genuine transient path-absent from `git show`.

## Not done

- **The remaining ~105 device checks stay on their building lanes.** Most correctly so.
- **`Q-7b`'s separate finding is untouched**: `/api/training-stress` computes an OTS yet the column
  is empty across all history, so its gating conditions are never met in practice — a live route
  returning gated forever, which is a different failure from "no producer exists". It stays in the
  entry, unfiled, and should become its own item.
- **No product code**, no device run.

## Gate

`pnpm ci:local` — exit 0, **Ran 77 of 77** Custom Rules steps (76 before this branch added
`check-prose-parked-entries`). Full log kept, not tailed.
