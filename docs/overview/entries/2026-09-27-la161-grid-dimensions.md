# LA-161 — record the two numbers the training-load gate decided from

**Branch:** `lane-a/la161-grid-dimensions` · **Lane A** · migration, ships alone.

## Why

TN-79's read earlier today (merged in #1758) showed production gating `insufficient_met` on days
whose stored frames replay to a 1421-minute grid with 1073 valid minutes, against floors of 720 and
360. One of those two readings is wrong and **nothing persisted said which**, so five weeks went
into arguing it from inference. Two integers end that.

## What shipped

- **Migration 288** adds `training_load_grid_len` and `training_load_valid_min` to
  `oura_daily_derived` — nullable, additive, so old rows stay NULL and NULL keeps meaning
  "never recorded". **Migration 289** is the regenerated `claude_ro` twin.
- `computeTrainingStress` returns `metGridLen` / `metValidMin` on **every** result, and the route
  persists them on every path.
- **They are computed before the first gate, not beside the MET one.** A `no_readiness` row with a
  1400-minute grid says something different from one with a 90-minute grid, and the three earlier
  gates previously recorded nothing about the day's coverage.
- Returned from the model rather than recomputed by the route, so what is persisted is what the
  gate actually evaluated — a second computation of the same expression is a second thing to drift.

## The near-miss worth recording

**The first generated twin silently dropped four columns, and it would have merged.** The
documented command in `CLAUDE.md` was

```
CLAUDE_RO_OWNER_USER_ID=<uuid> node scripts/generate-claude-ro-views.js > …
```

and the generator reads **`LOCAL_DATABASE_URL`**, not `DATABASE_URL`. Exporting `DATABASE_URL`
does not fail — it falls back to the session's own dev database, which in my case had the unmerged
LA-142 branch's `DROP COLUMN` applied to it from earlier in the session. So the twin came out
missing `active_calories_est`, `worn_hours_ble`, `vascular_age` and `pwv`, which are still on
`main`: a migration that would have removed them from the views for real, pre-empting an
owner-gated PR.

It was caught by diffing the generated file against its predecessor, which the standing rule
already requires — the rule earned its keep here. `CLAUDE.md` is corrected in this PR, and the
twin was regenerated against a scratch database built from this branch's own migrations.

Two smaller process notes from the same stretch: my local `trainingai_dev` had been left in a
mixed state, so it was dropped and rebuilt from the branch before anything was trusted; and a
`git checkout` to reset a mutation reverted the implementation file itself, which showed up as a
baseline that "failed" — the harness was wrong, not the code.

## Verification

- **New test, 5 cases**, including the boundary the rest of the repo cannot reach: the validity
  floor is `v >= 0.9` and no fixture anywhere sits exactly on it, so `>=` → `>` survives every
  other test. Also nulls counted as seen-but-not-valid, dimensions on gates that never reach the
  MET floors, the two floors that share `insufficient_met`, and an empty day.
- **Five existing strict assertions updated, not weakened.** They now pin the dimensions too, so
  each says *which* floor closed the gate — 600/600 (short but valid) against 1440/300 (long but
  sparse).
- **Mutation pass: baseline survives, 3 killed, 1 equivalent control survives.** Killed: `>=`→`>`,
  `metGridLen` reporting `validMin`, nulls counted as valid. Control: reordering the two fields.
- The two `claude_ro` tests over TCP: **2 files, 27 tests, all passed, none skipped** — the count
  `CLAUDE.md` names, so neither skipped silently.
- `tsc` clean; `check-test-typecheck` 316/87, none above baseline; Custom Rules **80 of 80**.

**No version bump or changelog entry** — nothing user-visible. The API response gains two fields
that no surface reads.

## Not exercised

No device run; this is a server-side column and a JSON field, with no native, safe-area or
offline-sync surface. The local SQLite mirror deliberately does **not** carry these columns — they
are diagnostics for the server, nothing on-device reads them, and Custom Rules' reconcile
completeness check passes without them.

**And the finding itself is not in yet.** This makes the question answerable; it does not answer
it. After a day of production, read the two columns: a short grid points at the ds window or at
`dsToMs` dropping rows, a full grid means the floors are being evaluated on something other than
what is stored. TN-79 carries that as its next step.
