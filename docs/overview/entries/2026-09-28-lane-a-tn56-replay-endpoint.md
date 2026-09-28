# 2026-09-28 — TN-56: an admin replay for thresholds whose inputs are never stored

The 2026-08-25 threshold sweep listed 25 constants it could not judge, because their inputs are
per-sample intermediates that nothing persists. `POST /api/admin/replay` re-runs a named function
over up to 60 days with one of its own parameters bracketed, across up to 12 values. It loads the
inputs once and evaluates purely per value. It writes nothing, and every response includes a run
at the defaults, whose `matchesStored` count shows how well the replay reproduced production. The
registry (`lib/tuning/replay/registry.ts`) is the only reachable surface: a function name and a
parameter it declares, within declared bounds.

The first function is `nightly-temperature`. `temperature-baseline.ts` takes `RANGE_THRESHOLD` and
`MIN_WINDOWS` as options, with defaults unchanged.

**Measured on the owner's real data (snapshot, 2026-09-01 → 27).** A replay inside the stored
`sleep_sessions` window reproduced production exactly on every night it scored, 11 of 11. But it
scored nothing on 7 more, because for those dates `sleep_sessions` holds only a daytime nap. The
night the rollup scored is not kept there, the same shape as LA-144. Clustering the night's own
sleep_temp frames finds every night but lacks the rollup's trimming. The shipped version uses
both: the stored window when it holds a scoreable night, the cluster otherwise. Result: **15 of 17
comparable nights exact**, the rest 0.05–0.31 °C off.

**Found on the way, shipped separately (#1900):** the local snapshot loader stored `bytea` values as
their JSON text, so every packed raw frame in a local snapshot was unreadable.

**Held for the owner** (LA-173 ⑤): `db-query`'s authorisation moved into one shared helper
(`lib/admin/claude-token-auth.ts`) with identical logic, which the new route uses. That touches auth,
so it is his yes. All 87 existing admin-guard and db-query tests pass unchanged.
