# 2026-08-17 — Q-389 planned, and three of its numbers corrected

**Branch:** `claude/implementation-lane-b-0o7kb9` · **No version bump** — docs only · **Lane:** Implementation B

## What this was

Q-389 (printable food labels for saved meals) is a feature request whose own entry says it *"wants a
planning session to produce a spec in `docs/superpowers/plans/` before anyone builds"*. The owner
settled its two open design questions earlier today, so it became the highest actionable Lane B item.
This is **PR 1 of the two-PR protocol**: the plan, and nothing built.

Plan: [`docs/superpowers/plans/2026-08-17-saved-meal-printable-label.md`](../../superpowers/plans/2026-08-17-saved-meal-printable-label.md).

## The three findings, which is the part worth reading

Tracing the code before writing the plan changed three things the entry asserts. All three are
corrected **where the wrong claim lives**, not just in the plan — an implementer who reads the entry
and not the plan must not build to a stale number.

**1. A 21×21 QR cannot hold a meal id, so the module pitch is ~16% finer than recorded.** The entry
derives 0.58–0.76 mm/module from *"a 21×21-module code holding just a meal id"*. Version 1 holds
**17 bytes** at EC level L. A UUID is 36 chars canonical, 32 as bare hex, and **22 as base64url of
the 16 raw bytes** — only the last fits version 2 (25×25) at EC **M**, and M is the level that
survives ink spread. Real pitch on the owner's circle-safe layouts: **0.49–0.64 mm**. The entry
already called that margin thin and named printer ink-spread as the expected failure mode; it is
thinner than it thought. Consequences: no prefix, no URL, no version tag inside the QR (each pushes
it to 29×29), and the test-print gate is now hard rather than advisory.

*Method, stated because it matters:* these are the QR spec's byte-mode capacity tables,
cross-checked by deriving them from codeword counts rather than quoted from memory (v1: 26 total − 7
EC = 19 data = 152 bits; −4 mode −8 length = 140 → 17 chars. v2 at M: 44 − 16 = 28 = 224 bits → 26
chars). **No encoder was run — there is none in the tree**, which is itself a finding: `@zxing/browser`
and the Capacitor scanner are decoders only, so half 1 needs a new dependency. The plan says the
implementer must re-confirm against whichever encoder they add.

**2. The "scan must log one serving, never infer one" requirement is already satisfied.** The entry
flags it as unresolved and defers it to when the scan-back is built. But
`packages/shared/src/nutrition/saved-meal-ingredients.ts` `oneServingItems()` divides every item's
quantity by `servings`, and `logMealItems()` iterates it on **both** its local-store and web-fallback
branches. The scan branch just calls the existing function — no new logging path, offline-first and
outboxed for free.

**3. …which exposes the live bug this feature can actually ship.** `SavedMeal.totals` is the **whole
recipe** — its own type comment says so. The obvious renderer reads `meal.totals` and prints it. So
a label would read **624 kcal** on a tub whose QR logs **312**: the two halves of one feature
disagreeing, silently, on a physical object stuck to real food — and the owner has just removed the
per-serving line that would have made it visible. **The label must render `totals / servings`**, and
the plan makes the first test assert both halves *against each other*, since asserting them
separately is what would let them drift.

Finding 3 only exists because of finding 2. Tracing the thing the entry said was unresolved is what
surfaced the thing it had not noticed.

## What is deliberately not here

**Nothing was built.** Per the backlog protocol this is the docs-only half; the implementation is a
separate later PR, and the plan's §5 gives its build order (payload codec → encoder dep → renderer →
preview/delivery → scan branch → print test).

**No aesthetic was chosen.** Four mockups exist in a design canvas outside this repo and none is
picked. The plan does not invent one.
**Addendum 2026-08-18 — chosen in parallel, and the plan is updated rather than this entry:** a
concurrent session settled it as four cycleable styles with **black band the default**, and redrew
the mockups at the 25×25 code this session's finding 1 forced. So the renderer is a *set of four*,
not one, and every face they use has to be embedded. The plan's §7 carries it; this paragraph stays
as written because it was true of the plan when it landed.

**The staleness question (entry decision 3) is answered provisionally, not settled.** The plan says
build show-current rather than versioning, on the ground that versioning costs payload bytes finding
1 says the design cannot spare. If the owner wants a staleness warning in use, that is a follow-up
and — being a schema change — Lane A's.

## What was NOT exercised

- **No code ran.** This is a source trace plus arithmetic. The capacity figures are from the spec,
  derived twice, not from an encoder.
- **Nothing was printed or scanned.** The whole physical half of this feature — die shapes, ink
  spread, whether a 0.49 mm module survives a home printer — is owner-side and is the plan's §7.
- **The native scan path is unreachable from here** regardless: the Capacitor plugin is inert in the
  sandbox, so even the built feature will only be half-verifiable in CI.
