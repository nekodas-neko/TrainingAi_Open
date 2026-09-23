# 2026-09-23 — OR-130: a ratchet that could not read its base blamed the branch

**Branch:** `fix/or-130-base-read-failure` · **Lane:** O (Orchestrator) · docs + `scripts/lib` only

## What was wrong

`fileAtBase` in `scripts/lib/base-ref.js` returned `null` for two different facts — *"this file is
not at the base"*, which is what a branch adding a file looks like, and *"I could not read the
base"*, which is nothing known at all. `verdict` maps a `null` base to `'fail'`, so the second
became an accusation: a file byte-identical to `main`, named as this branch's new violation, on a
branch that had not touched it.

Eleven scripts read the base through this helper.

## The CI question, decided first, because it inverts the fix

The entry carried a warning: CI checks out at depth 1, so *"do not fail on unreadable"* might
disable the ratchet everywhere rather than just locally. Measured rather than reasoned about.

`.github/workflows/ci.yml` fetches the base with `git fetch --depth=1 origin main || true`. **When
that fetch fails, no ref resolves at all** — `resolveBaseRef` returns `null`, every `atBase` is
`null`, and `verdict` falls back to the plain absolute comparison, which is *stricter* than the
base-aware one. The CI step's own comment says as much.

So turning an unknown base into a pass would not have fixed this bug. It would have disabled every
base-aware ratchet in the repo on any fetch blip. **The outcome of an unreadable base is therefore
unchanged on purpose; only the lying stopped.**

## What shipped

- `showAtBase` classifies git's own stderr. `does not exist in` / `exists on disk, but not in` is
  the only wording counted as absent. Measured against git on the day, not recalled.
- Anything else is a read failure: three attempts with a 40 ms / 160 ms backoff, then a warning
  carrying git's own words.
- `resolveBaseRef` also probes the tree behind the commit it picks. A resolvable commit is not a
  readable tree, and a base we cannot see should degrade to no base rather than failing one file at
  a time.
- Seven regression cases, plus three that pin the strict fallback so a later session does not
  "finish the job" by turning it into a pass.

## The part worth carrying: the mechanism was never reproduced

The entry stated the cause confidently — a shallow clone, `git show` failing when the blob is not
in the pack. **That did not survive testing.** 24 concurrent runs of the affected script triggered
nothing, with and without the fix, and `git show origin/main:<path>` succeeds for every path asked
directly.

So the retry is a reasonable guess and the diagnostic is the part that earns its place: the next
occurrence prints git's own reason, which is the evidence this instance never produced. A fix whose
mechanism is unconfirmed should say so in its own comment, or the next session inherits a certainty
nobody measured.

It fired again during this session's own gate run — third sighting, same shape, clean on a direct
re-run a minute later. That is the argument for instrumenting it rather than retrying harder.

## Not done

- **`OR-121`'s first instance stays open.** It was `check-tz-aware-cache-guards.js`, which does not
  use `base-ref` at all. Two flakes of similar shape are not one cause.
- **No device surface touched** — this is a build-gate script. Nothing to exercise on the S25, and
  no offline-first, native, safe-area or notification path involved.

## Gate

`pnpm ci:local` — exit 0, **Ran 75 of 75** Custom Rules steps, **8,058 tests passed**, run unpiped.
