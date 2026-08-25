# 2026-08-25 — the reclaim reclaimed nothing, and it was right to

**Branch:** `fix/error-events-premise` · **Lane A** · docs only. LA-31, and LA-30 filed for Lane B.

The owner pressed the vacuum button this session. It reported:

```
error_events: reclaimed 0 B (49 MB → 52 MB, 24 live rows) in 1.5s
```

Read as a failure, that is a broken `VACUUM FULL`. It is not. **The table was never bloated**, and
the entry that asked for the reclaim was built on a number nobody had checked.

## What is actually in there

Measured against production, not inferred:

| | |
|---|---|
| heap / index / **TOAST** | 12 MB · 728 kB · **39 MB** |
| rows, **owner's alone** | **6,168** |
| message bytes / stack bytes | 11 MB · **45 MB** |
| oldest → newest | 2026-07-26 → 2026-08-25 (exactly the 30-day prune) |

56 MB of live payload against a 52 MB table. `VACUUM FULL` found nothing dead because there is
nothing dead.

## Where "4 live rows in 49 MB" came from

`n_live_tup`. `CLAUDE.md` devotes a paragraph to exactly this: it is a planner estimate maintained by
`ANALYZE`, `last_analyze` is NULL on every table in this database, and *"to ask whether a table is
empty, run `count(*)`"*. The estimate read **24** against **6,168**.

That figure had propagated into Q-315's heading, two other backlog entries, three `projectOverview`
paragraphs and the Lane A baton. **I wrote the baton an hour before this measurement, and it repeats
the wrong figure two sections above where it states the rule.** Knowing a rule and applying it are
different things, and a number that arrives already written down does not feel like a claim needing
verification — which is precisely what makes this class survive.

## The rows are one already-fixed burst

Three days carry **5,928 of the 6,168** and 42 of the 45 MB:

| day | rows | dominant message |
|---|---|---|
| 2026-08-09 | 2,615 | `[pg 21000] Failed query: insert into "oura_heartrate"` |
| 2026-08-12 | 2,556 | same |
| 2026-08-13 | 757 | same |

Postgres `21000` is `cardinality_violation` — *"ON CONFLICT DO UPDATE command cannot affect row a
second time"*, raised when one command's VALUES list hits the same conflict target twice. It rejects
the **entire command**, so each of those 5,771 rows is a whole HR chunk discarded, up to 5,000 points.

**That is Q-214, fixed 2026-08-13** — `upsertOuraHeartrate` now collapses repeats into a `Map` keyed
by timestamp before inserting, with a comment naming this exact failure. The burst stops on
2026-08-13. Fixed rather than merely stopped: the code and the dates agree, which is the standard
`CLAUDE.md` sets for not writing "fixed" from intent.

**No action is owed.** The prune is working, so those days age out by ~2026-09-12 and the table
returns to a few MB on its own. The last 7 days hold **39 rows**.

## The live bug this session actually found

Filed as **LA-30**, queue position 1, **Lane B's** — the owner scanned a ZMA supplement, the AI read
it correctly (*"It is calorie-free"*), and `components/nutrition/review-step.tsx:159` says:

```ts
const canSave = value.name.trim().length > 0 && value.calories > 0
```

**Next** greys out, with nothing on screen saying why. Every zero-calorie item is refused —
supplements, water, black coffee, diet drinks, sugar-free gum, spices. The server disagrees:
`packages/shared/src/validation/food-item.ts:19` is `z.number().min(0)`, so the API would have taken
the log. No engine half, so it is one client predicate and belongs to Lane B by the path rule.
`components/nutrition/ingredient-picker.tsx:154` carries the same rule and treats a zero-calorie scan
as a *failed* scan — sibling surface, same PR.

The silent disable is half the defect. The report was *"it wouldn't let me log it"*, not *"it told me
why"*.

## Verified

- Every figure above is from `POST /api/admin/db-query` against production, run this session. Row
  counts are the **owner's only** — `claude_ro` is row-scoped — and are written that way; the sizes
  come from `pg_stat_user_tables` and are whole-database.
- Q-214's fix read in source at `lib/data/postgres/slices/oura.ts:494`.
- `pnpm check:rules` **Ran 58 of 58** · `check-doc-links` OK (871 files) · `next-item.js --lane B`
  shows LA-30 at READY #1, confirmed rather than assumed.
- Baselines re-derived from the merged files after `origin/main` moved mid-session:
  `projectOverview.md` 7973 → **7977**, backlog 11725 → **11710** (down — Lane B's merge landed
  between). The baton was **trimmed to fit 178** rather than raised.

## Not exercised

Docs only — no code, no schema, no migration. The LA-30 fix is not in this diff; it is filed, not
done.
