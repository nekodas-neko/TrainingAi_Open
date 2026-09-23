# 2026-09-23 — OR-134: `Gate: device` was doing three different jobs

**Branch:** `chore/or-134-device-gate-triage` · **Lane:** O · queue state only

The owner asked whether device-testing items had actually reached the DV agent. `OR-133` made them
*visible*; this asks whether the ones now visible are really the device agent's to run.

They are not all the same kind of thing. **`Gate: device` is carrying three meanings that lead to
opposite next actions**, and nothing in the field distinguishes them:

1. **A check the phone can settle** — the entry has shipped or reproduces on the APK. This is the
   Device Verification agent's work and the gate is correct.
2. **A build that has to happen first**, where the phone is how the result is *verified*. The gate
   parks buildable work behind its own verification, so nothing can ever discharge it.
3. **Hardware that is not in the building** — a Colmi R09, not the S25. No sitting and no lane can
   hurry it, and the DV agent cannot touch it.

## Kind 2 — two circular gates released

Same shape as `BF-165` and `LA-49` earlier this month: *a condition for becoming startable that can
only be met by someone who can already start it.*

**`LA-115`** read *"needs a new APK and an on-device Health Connect permission grant"*. Both true,
neither blocking — the fix is a patch to the pinned plugin's `RecordConverter`, Kotlin, compile-gated
in the sandbox like every other `android/**` change. The APK and the grant are how it is **verified**,
and they can only follow the build.

**`TN-44`** read *"every new type needs a plugin patch and a new APK"* — which is a description of
the **work**, not a reason it cannot start. Worse: this entry carries an owner decision from
2026-09-17, eight lines below the gate, **not to block** and to build against synthetic data. A gate
contradicting a decision recorded on its own entry is the clearest possible case of a field nobody
re-read.

Both now carry what is genuinely owed — a `Verify: device` after the build, where the
external-field rule applies: a wrong key reads as `undefined`, so a green build proves nothing.

Gates: **102 → 100.**

## Kind 3 — marked, not released

`PS-8`, `PS-9` and `PS-16` are gated on the **Colmi R09**, which is with a second wearer. The gate is
correct and the entry is genuinely blocked; what was wrong is that it read as owed *device-check*
work, which invites the DV agent to pick it up and the owner to feel it is theirs to clear. Each now
says outright that it is not an S25 sitting and is waiting on hardware returning.

## The finding I did not act on, and why

**Three entries carry a bare `Gate: device` with no reason after it** — `Q-168`, `Q-7b`, `PS-12`. A
gate with no clause cannot be evaluated: it does not say whether the phone is needed to build, to
check, or because hardware is missing, and those lead to three different next actions.

**Deliberately not released.** Two of their neighbours turned out to be circular and one guards
hardware that is not here — so un-gating on the assumption that this one is circular too would be
exactly the unchecked move that created the problem. They are flagged where the next person to touch
them will read it: write the reason or remove the gate.

That is the general rule worth keeping: **a gate is a claim, and a claim with no reason attached
cannot be discharged by anyone except the person who wrote it — who is gone.**

## And the half of OR-130 I missed, found by its fourth occurrence

The gate run for this PR failed on `app/api/user/goals/route.ts` — byte-identical to `main`, named
as this branch's new violation. That is OR-130's bug, whose fix shipped this morning.

**The fix did not fire, and the log proved why: no warning appeared.** So the base read did not
fail. OR-130 instrumented `fileAtBase`, the path where a *per-file* read fails. **That is not the
path that fires.** When no base ref resolves at all, `fileAtBase(null, …)` returns `null` without
consulting git — so no per-file warning can exist — and `verdict` turns that `null` into `'fail'`.

The ratchet then runs in **absolute mode** while its output still reads as a judgement about the
branch. Four occurrences, and every one of them spent its diagnosis on the wrong half.

`resolveBaseRef` now says so when it comes up empty, naming the refs it tried. **No verdict changes**
— absolute mode is stricter than the base-aware one and stays exactly as it is. What changes is that
a reader can tell which mode produced the answer in front of them, which is the whole of the defect.
The ref list is injectable so the path is testable; callers pass nothing.

**This does not belong in a docs-only triage PR** and is here because it blocked it: the gate could
not go green without it. Said plainly rather than filed as a tidy coincidence.

### Then the flake hit a fifth time, and the reason no warning ever fired is measured

`execFileSync`'s return value is **stdout only** — verified: a child writing to stderr does not
appear in it. The ratchet scripts are spawned that way by their own tests, and
`strict-schema-inert.test.ts` asserts on exactly that return value. **So a warning written to
stderr cannot appear in anything that test sees or reports.**

Across five occurrences, *"no warning fired"* was taken as evidence **three times** — including the
conclusion earlier in this very entry that the no-base path must be the one firing. It was never
evidence. The diagnostic was being written where the observer structurally could not look.

Both warnings move to stdout, with two tests pinning it: one proving `execFileSync` drops stderr,
one proving a spawned `base-ref` run reports its warning. **No verdict changes** — this is where the
message is written, not what the ratchet decides.

**A diagnostic in the wrong stream is worse than none, because its silence reads as information.**
That is the lesson of OR-130 and OR-134 together: OR-130 built the warning and this is the first
occurrence where anyone could have read it.

**The flake itself is still undiagnosed** at five occurrences. What changes is that the sixth will
say something.

## Not done

- **The other 18 of the 24 are not individually classified.** The three kinds are now named and the
  clearest cases of each are fixed; the rest need the same read and it is real work, not a sweep.
- **No product code**, no device run, nothing to exercise on the S25.

## The compaction sweep rode along, because the gate said it was mine

The entries directory hit **61 against a 60-file runaway limit**, and the check named the reason
this PR had to deal with it: *"This branch adds 1 of them, so the sweep is yours: you are already
here."* A threshold that lands on whoever happens to cross it is the right design — it cannot
accumulate into a chore nobody owns.

`node scripts/fold-journal-entries.js --limit=25` (dry-run first) folded 25 entries into
`history-2026-09-23-folded-1.md`, held back 6 cited by an agent baton, and rewrote citations in two
domain indexes. 73 → 48 loose entries.

The script's closing instruction is worth repeating because it is the right instinct: *"now run
`check-doc-links.js` and fix what it names — do not reason about which links moved."* Run: **OK, 838
files checked.**

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps. Full log kept, not tailed.
