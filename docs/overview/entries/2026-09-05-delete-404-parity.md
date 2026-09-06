# 2026-09-05 — six sibling deletes stop reporting success for nothing (RV-45)

**Branch:** `fix/rv45-delete-404-parity` · **Lane:** A · **Domain:** platform / nutrition

## The finding

Q-556 shipped a 404 on `activity-logs` with the comment *"Match every sibling delete: 404 for both a
nonexistent id and someone else's."* Review sweep 47 probed the siblings: **six of seven answered
200**. The direction was backwards — `activity-logs` was the only one doing it, not the one catching
up.

The measured half that matters: a second account deleted the first's supplement and got
`200 {"ok":true}`, with the row still in Postgres and its owner unchanged. **Ownership is enforced —
the answer was what was wrong.** A correct refusal reported as a success is indistinguishable from a
real delete and reaches `error_events` never.

Not cosmetic, either: `manage-supplements-sheet.tsx` and `injury-sheet.tsx` both do
`if (!res.ok) throw`, then drop the row and toast "deleted". A delete that removed nothing confirmed
itself, and the row came back on the next pull.

## What changed

Seven repository methods went `Promise<void>` → `Promise<boolean>` via `.returning()`, and their
routes 404 when false. **The predicates are untouched** — this reports on the match, it does not
change which rows match, which is the thing to check first when reading this diff.

The two throwing pre-checks are deliberately unaffected: `MealTypeHasLogsError` still answers 409 and
`deleteActivityType`'s in-use guard still throws. *"This has entries"* is not *"this does not exist"*.

## A test pinned the old behaviour, and it worked

`not-found-status.test.ts` required 200 with the comment *"Pinned so it does not get 'fixed' later."*
That is the 2026-08-18 decision, which declined to file these routes on the grounds that DELETE is
idempotent and *"the desired end state (row absent) genuinely holds"*.

It stopped me, which is what it was for. The reversal is recorded **in the test**, with the cause:
that premise is true for the owner re-deleting their own row and **false across accounts**, where the
row is present and correctly so. Q-556 reached the same conclusion independently and shipped it.

`delete-404-parity.test.ts` now holds all seven together, because a sweep that aligns seven surfaces
and pins none of them diverges again the next time one is touched. Mutation-verified: reverting two
routes fails exactly those two, by name.

## Not exercised — and this one has a real edge

Every changed route was confirmed loading and failing closed on `pnpm dev` (401 without a session);
the 404 branch runs in tests against local Postgres with a mocked session.

**The device path is not checked, and it is the half where this could bite.** These deletes now make
a previously-silent no-op loud. On device, supplements and injuries write locally first and take the
API as a *fallback* — a path the web build never runs — so an error toast for a delete that genuinely
worked locally is the failure to look for. The queued-but-unpushed race is reconciled by the push arm
(Q-328) and every affected domain is in `SYNCED_MUTATION_DOMAINS`; that is established from source,
not observed on hardware. RV-45 keeps it as a `Verify: device`.

## Gates

`tsc --noEmit` clean · `pnpm check:rules` 68 of 68 · full suite 759 passed | 5 skipped (764 files),
6456 tests passed.
