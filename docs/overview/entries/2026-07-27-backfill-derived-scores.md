## 2026-07-27 — Backfill the persisted Sleep/Readiness scores (v1.222.0, audit finding F-2)

`oura_daily_derived` only ever gained a score as a side effect of loading `/api/readiness-score`,
which writes **today** and nothing else. 12 of 70 rows carried one, so any calibration analysis over
that table was working from a **21% sample** — and the 12 that existed were written by three
different eras of the Sleep Score model.

### What shipped

`POST /api/admin/backfill-derived-scores?from=&to=&dryRun=` — admin-only, bounded to 31 days per
call, sequential.

It recomputes each day through **`buildDayAudit`** — the same compute functions the live route serves
from — so no formula is restated. What it writes comes from a new `PillarAudit.persist` field that
the sleep and readiness audits fill with *exactly* the payload the live route persists.

That last part is the whole design. The audit's presentation `contributors` are a different shape
from the stored JSONB, so deriving the stored value from them would have created a second, drifting
definition of "what gets stored". Instead both paths read one field. The readiness half also pins a
subtlety: the live route persists `ownComposite.score`, the composite **before** the illness
suppression — not the score shown on screen. A backfill writing `displayedScore` would have looked
right and been wrong on every suppressed day.

**Safety:**
- **`dryRun` is the default** — only an explicit `dryRun=false` writes, so a range can be inspected
  first. It reports `written` / `unchanged` / `no-score` per pillar either way.
- **Sequential, 31 days max, 4 calls/minute.** Each day runs ~12 queries against a `max: 10` pool;
  fanning a range out concurrently is the failure mode that took production down in session 165.
- **Two disjoint upserts**, mirroring the live route — the shared `source`/`model_versions` columns
  are replaced wholesale by the upsert, so writing them here would clobber body_comp/illness
  provenance on the same row.
- **One unscoreable day never aborts the range** — it is recorded with its error and the loop
  continues.

### Verification

Full CI-equivalent suite green, typecheck, lint and both custom-rule checks clean.

Five new DB-backed tests, the important one being that **a backfilled row equals a live-written one**:
seed a night, backfill it, delete the row, call `/api/readiness-score`, compare. If those ever
diverge the table this fills is worse than the sample it replaces.

`pnpm dev` against local Postgres, 14 days:

| step | result |
|---|---|
| dry run | reports 14 sleep writes, DB unchanged (1 row before, 1 after) |
| `dryRun=false` | 14 rows, all with `sleep_score` **and** `sleep_contributors` |
| re-run | `written: 0, unchanged: 14` — idempotent |

Guards checked on the live server: 31-day range cap, invalid date rejected, **slash-form
`YYYY/MM/DD` accepted** (the date-param rule), 401 unauthenticated, 405 on GET, and the 4/min rate
limit firing.

**Not exercised — on-device.** Admin-only server route, no native path, no UI.

**A flake this shipped with, caught by CI.** The first CI run failed Tests while the same suite passed
locally — twice, including against a freshly-migrated database. The cause: `rateLimit` is
**two-layer**, an in-memory L1 plus the `rate_limits` **table** as L2, and `flushKey` treats the DB as
authoritative (`entry.count = Math.max(entry.count, dbCount)`). The test helper is honestly named —
`_resetRateLimitL1()` clears *only* memory — so the DB row kept accumulating across the file's ~8
calls against a limit of 4. Because the flush is fire-and-forget, a fast machine finishes the test
before it lands and a slow one doesn't: green locally, red on CI. The fix awaits in-flight flushes,
clears L1, **and** deletes the L2 row. Any future test that resets the limiter needs all three —
clearing L1 alone is a coin flip, not a reset.

**A gotcha for the next session:** the timezone rule is enforced twice by two different mechanisms,
and they disagree. The eslint rule (`no-restricted-syntax`) is AST-based and only sees code; the
Custom Rules CI job is a raw `grep` over `.ts`/`.tsx` and cannot tell code from comments. A *comment*
quoting the banned UTC-slice pattern therefore passes `pnpm lint` and fails CI — which is exactly
what happened here. Don't write the forbidden pattern out even to warn about it.

### Worth knowing

- **Readiness backfills only where a daily summary exists.** In the local run all 14 days reported
  `readiness: no-score` because the seeded DB has no `oura_daily_summary` rows —
  `computeReadinessComposite` needs one, and the route correctly declines to invent a score rather
  than persisting one built from absent inputs. In production the summary rows exist, so this will
  fill; a day genuinely missing its summary stays empty, which is the honest outcome.
- **It has not been run against production.** The route is deployed; someone still has to page
  through the history with `dryRun=false`. Until then `oura_daily_derived` keeps its 21% coverage.
- Because the recompute uses the *current* model, backfilled rows put the pre-v1.215.0 days onto one
  consistent Sleep Score — which is the point, but it does mean a stored score may no longer equal
  what was displayed on the day. The day audit's `storedMatchesRecompute` flag exists for exactly
  this and will read `true` more often after a backfill, not less.
