# 2026-08-16 — Q-49 Phase B step 8: the snapshot is public

**Domain:** platform · **PRs:** #1393, #1396, #1397 (all in this repo) + one push to the new one

`nekodas-neko/TrainingAi_Open` holds one commit, `6c072f9` — 3,253 files, 45 MB, `git archive` of
`main` at `c9df8db`. A snapshot, not a history rewrite: ~89 MB of material sits scattered across the
old history and missing one trace is the failure mode.

Verified the way the runbook specifies rather than by inspecting the tree that produced it — cloned
the pushed repo fresh and ran `check-private-paths.js` there. Every row reads "already removed" or 0
files; `total tracked: 0.0 MB`.

## What the pre-push audit actually found

The audit was not a formality. Three things had to be fixed first, because after a push they are
public permanently.

**The owner's email, in two historical docs** (#1393). Both quote a long-dead admin check by its
literal address. Migration 006's hardcoded address had already been removed during this migration for
precisely that reason — "a personal detail the public repo should not carry" — so this was applying a
decision the project had made, not making a new one. They were the only two occurrences in the tree
and the only two files naming the owner at all.

**`scripts/private-paths.json` catalogued what it was protecting** (#1396). Its `reason` fields
described what each removed path contained, and the entry for the most sensitive one restated the
substance of the file itself. An inventory that describes its contents is a map to them. Worse, the
*same description* had been copied verbatim into `docs/overview/entries/2026-08-10-github-repo-migration.md`,
so trimming only the manifest would have bought nothing — a reader would have found it one file over.
Owner instruction was "vague so other people can't understand but our agents can": the `reason`
fields now say what an agent needs to classify a new file and refuse to commit it, the `kind` slugs
moved from naming a method to naming a category, and the mechanics the tooling depends on are
untouched.

Be honest about what that buys. It removes the specifics and the method, which is the actionable
part. It does not make the subject unknowable — `NOTICE` states outright that third-party model
weights exist and are excluded, because that is its job, and the published BLE port is itself
evidence of what was done. The owner's 2026-08-10 decision already accepted that trade for the port.
That sentence is now written into the manifest entry so it does not get lost.

**`main` was red on E2E, and had been for eight hours** (#1397). Found by refusing to re-run #1396's
failed check without reading it. `seed.sql` built every date from `current_date` — the Postgres
server's date, UTC in CI — while the app reads "today" in the user's timezone, and the seeded user is
`Australia/Brisbane` (UTC+10). From 14:00 UTC the two disagree by a day, so the newest seeded row is
yesterday as far as the app is concerned. `goal-invalidation.spec.ts` asserts a steps goal on Health's
Progress panel, and `goals-progress-card.tsx` drops rows whose value is null — so the row it looks for
could not render, and the spec failed for **ten hours of every day**. It passed when it landed because
that merge was in the morning; #1391 and #1393 passed for the same reason, at 11:09 and 11:40 UTC.

This is the repo's own banned UTC-date pattern, expressed in SQL. The fix is one anchor,
`today date := (now() AT TIME ZONE 'Australia/Brisbane')::date`, used for all five seeded domains so
they cannot drift a day apart from each other either. Confirmed by CI, not just locally: E2E green at
21:38–21:44 UTC, inside the window that had been failing.

Nothing to do with the migration — but it would have blocked step 9's throwaway PR just as surely.

## One thing left open, deliberately

`lib/data/postgres/__tests__/periodization-soft-delete.test.ts > getWeeklySetsByMuscleGroup` fails
locally (3 of 21). It is **not** the seed change: it fails with the original seed restored and on
pristine `main`'s code. CI's Tests job passed on the same window on a fresh database, which points at
accumulated local DB state rather than a `main` breakage.

Not root-caused, and not claimed to be harmless. The honest status is "reproduces locally, not in CI,
cause unknown". The tell is its shape — `expected undefined to be 1`, a *missing* row rather than a
duplicated one — which is worth knowing before someone burns a session on it.

## What is public now, and what is not

Public: the whole application, the tests, the CI workflows, and 1,039 markdown files of engineering
record — reviews, handoffs, production data audits, incident post-mortems. That was an explicit owner
decision ("publish it all — it's the project's value") rather than a default.

Not public, and enforced by a CI gate rather than by care: everything in
`scripts/private-paths.json`. The application obtains the models and constants from private object
storage at boot, and fails the boot in production rather than serving a degraded result — see
`NOTICE`.

## Next

Runbook steps 9–14. Rollback stays available until the last of them, which archives the old
repository rather than deleting it.
