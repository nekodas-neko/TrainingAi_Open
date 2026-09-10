## 2026-09-10 — Q-28's tripwire was prose, so eleven domains were added without anyone re-running the number

Lane A. Q-28 (`applyDelta` crosses the Capacitor bridge once per row) stays deprioritised — the
batching refactor is **not** built here, and the re-measurement says it still should not be. What
shipped is the guard the entry asked for and nobody wrote.

**Re-verified against `main` and production before touching anything, and four numbers were stale:**

| claim | entry said | measured 2026-09-10 |
|---|---|---|
| delta domains | 20 | **31** |
| full-restore rows | ≈1,800 | **3,544** (+92% in five weeks) |
| `oura_heartrate` rows | 37,950 | **111,246** |
| `runSQL` / `applyDeltaBody` | `sqlite-service.ts:134` / `sqlite-backend.ts:1186` | `:198` / `:1252` |

**The verdict survives all four.** 3,544 is still the low end of the entry's own criterion, not the
five-figure case, and it is still a one-time path on the code with the worst data-loss history in
the repo. What changed is the *tripwire*: the entry says adding a high-cardinality timeseries makes
the refactor urgent in the same PR, and at 111,246 rows the HR series is now a **32×** multiplier on
the restore rather than the 22× the old figures implied.

**That tripwire was a sentence in a backlog entry, and prose does not block.** Nothing made a PR
adding a domain notice it — which is exactly what happened eleven times. `check-apply-delta-domains.js`
(Custom Rules, step 73 of 73) now freezes the domain list: adding one fails with the question to
answer first — how many rows, at what cardinality — rather than passing silently. The extraction
lives in `scripts/lib/apply-delta-domains.js` so the check and its test cannot drift, per the same
lesson `lib/lane.js` carries.

**Mutation pass, 4 mutants, 2 controls.** M1 (a plain `delta.ouraHeartrate` inside the method) —
CAUGHT. M2 (method renamed) — CAUGHT, with a message saying to re-point the check rather than delete
it. M3 control (a baselined domain referenced twice) — SURVIVES, correctly. M4 control (a new
`delta.*` in a *different* method) — SURVIVES, which is the brace-walk scoping the unit test pins.

**One mutant had to be rewritten, and it is recorded rather than quietly fixed.** M1's first version
wrote `(delta as any).ouraHeartrate` to satisfy the typechecker, and the check missed it — read as a
miss until the mutant was corrected. The scan is textual, so a cast genuinely does hide an access.
That is now stated as an honest limit in the check's header beside the "a committed baseline can be
regenerated" one. A real domain addition types the delta and reads `delta.x` directly, so the gap is
narrow, but it is a gap and it should not be discovered by the next person.

**Not exercised:** the bridge-crossing cost itself is still device-only — native SQLite does not run
in the sandbox, and nothing here changes runtime behaviour in any case (a CI check, a JSON baseline,
a test, and backlog prose). Row counts are production reads through `/api/admin/db-query`, which is
**row-scoped to the owner** — the restore figure is one user's restore, which is the right scope for
this question, but it is not a claim about anyone else's.
