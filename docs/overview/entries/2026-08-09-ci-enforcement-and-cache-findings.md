# 2026-08-09 — Mechanising three rules, and one gap found by testing the tests

**Branch:** `claude/token-usage-strategy-7cx7z9` → `ci/*`, `chore/*` · **Domains:** `platform`, `app-shell`

## The thread this session kept pulling

Every rule this session checked fell into one of two states: **in CI and holding**, or **written down
and drifting**. Nothing in between. The sparkline count went 5 → 6 days after it was last re-verified.
Hex literals, policed by nobody, sat at 455 for weeks. Meanwhile `check-timezone-rendering` has kept
device-local rendering at zero since it landed.

So the work was to move rules across that line, and to check the checks already on it.

## Two rules mechanised (#1192)

- `scripts/check-numeric-bounds.js` — a `z.number()` with no `.max()` in a validation schema (Q-164).
- `scripts/check-sparkline-primitive.js` — a `<polyline>` mini-chart instead of `components/ui/sparkline.tsx` (Q-154).

Both use the shrink-only grandfather pattern: a new violation fails, **and** a grandfathered file that
gets fixed but stays listed also fails. That second half is what stops an exemption list rotting into
a permanent one.

**A count correction fell out of writing the check.** It originally scanned only the first
`z.number()` per line and reported **24**; `z.object({ km: z.number(), paceSec: z.number() })` appears
four times in the file it guards. The real figure is **28** — so the backlog's original number was
right and my earlier recount of 24 was the wrong one. What *was* wrong was the framing: all 28 sit in
`activity-log.ts` and the other 14 schema files are fully bounded. One file that missed a house
pattern, not a systemic gap — and a single focused PR rather than a sweep.

## Testing the tests found a real gap (#1193)

Rather than read the existing checks, I planted a violation in each and confirmed it failed.
`check-reconcile`, `check-push-mutations`, `check-doc-links` and `check-color-mix-hue` all genuinely
fail when they should.

But `check-reconcile` scans `ALTER TABLE … ADD COLUMN`, so **it cannot see a column added to a
`CREATE TABLE IF NOT EXISTS` body** — and that is the dangerous case. `CREATE TABLE IF NOT EXISTS` is
a no-op on a device that already has the table, and `reconcileSchema()` adds only columns named in
`RECONCILE_COLUMNS`. Such a column exists on fresh installs and is **missing forever** on upgraded
ones; every `INSERT` naming it throws on exactly the devices running longest, while tests, the web
sandbox and every fresh install stay green. That is the #85 class that killed the local DB on Android
twice.

`scripts/check-local-column-upgrade-path.js` closes it. **Zero live instances** — swept across all 41
commits touching `migrations.ts` — so it ships with no grandfather list.

**One candidate surfaced and was refuted.** `supplements.updated_at` looked late-added, but `git blame`
had re-attributed the line to #1146 because appending `deleted_at` added a trailing comma to it. The
column predates that commit. Keying on column *names* rather than lines removed the artifact.

**A methodology note worth more than the finding:** the first history sweep silently saw only **3
commits**, because the session clone is shallow (99 commits). It returned a confident "none found"
that meant nothing. `git fetch --unshallow` first, then sweep — and treat any history-based all-clear
without a commit count as unverified.

## Scope gap in three CI greps (#1194)

Three inline Custom Rules greps scanned only `app/ lib/ components/`, leaving **`packages/`
unscanned — 229 files, 21% of the TypeScript surface**, and where `date-utils`, the validation
schemas and the health formulas live. Now widened (plus `hooks/`, `types/` for the UTC guard). All
three areas verified clean at the new scope, so this is coverage, not a fix.

## Two cache findings, and a deliberate decision *not* to mechanise

**Q-165:** 171 client GETs use `cachedFetch`; **62 use bare `fetch`**. 29 of those are admin/debug
consoles (arguably correct — CLAUDE.md already exempts those directories from the device-local-time
rule for the same reason); 33 are user-facing; ~9 of those have a real reason to stay uncached, such
as `/api/oura-ble/freshness`, where caching a *freshness* probe defeats the point. That leaves ~24 to
triage.

**And this one should not become a CI check yet.** With nine legitimate exceptions in 33 cases, the
exemption list would be about as long as the violation list — a rule that documents drift rather than
preventing it. The opposite call from the two checks above, and the difference is exactly the size of
the exception set.

**Q-166:** 44 of 124 GET routes carry no `Cache-Control`; 24 after excluding admin, OAuth and webhook
routes that must never cache. Filed below Q-165 — client-side caching already covers repeat-visit
paint where it's used, so this costs a round-trip, not correctness.

## CLAUDE.md counts, re-measured

Four had drifted, and **they drifted in both directions**, which is the argument against trusting any
hand-maintained count: `@use-gesture/react` went from "zero imports" to **4** (the stale line made an
established pattern read as untried, which argues *for* hand-rolling the next one), hand-rolled swipes
2 → **3**, hex literals 455 → **430**, chevron toggles without `aria-expanded` ~18 → **9**, and
`health-sections.tsx` dropped under the 800-line hotspot threshold.

## Not covered

No device, no APK, no native SQLite — the local-column hazard was verified by reading
`reconcileSchema()` and by history sweep, never by running an upgrade on hardware. A scan for
interactive content nested inside a real `<button>` (a rule CLAUDE.md states but nothing checks)
produced seven candidates that were **all false positives** — the depth counter mishandles a
same-line `<button>…</button>` — so that rule remains unmeasured rather than reported. Contrast is
still unmeasured after the three attempts logged on 2026-08-08.
