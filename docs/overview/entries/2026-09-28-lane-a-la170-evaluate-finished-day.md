# 2026-09-28 — LA-170: a finished day gets a whole-day training-load verdict

TN-79's read showed `/api/training-stress` only ever evaluating today. It re-persists on every call,
so a day's stored gate was the last evaluation made during that day, and a morning one cannot pass
the 720-minute MET floor.

- **Migration 292** adds `oura_daily_derived.training_load_evaluated_at`. It is the first real
  migration after BF-214, so `claude-ro-views.sql` was regenerated in place, and the diff is the one
  column. Like `acwr` it is server-only: in `DERIVED_COLS` and the push branch so the drift tests
  hold, and absent from the device mirror, so a device never sends it.
- **The route** stamps every write. When today is read, it re-evaluates yesterday in the background
  if yesterday's verdict was stamped before yesterday ended, or was never stamped. A verdict
  computed after the day's end is final, so this runs at most once per day.
- **Noted for the device rollup (OR-123):** the gate and grid columns are in the device mirror.
  Nothing on the device writes derived rows today, but once the on-device rollup pushes them, a
  stale pulled gate could overwrite a final one. Revisit then.

**Mutation pass:** no yesterday pass, inverted finality, the gated arm left unstamped, and the pass
also firing on an explicit `?date=` were all killed. The control survived.

**Not observed yet:** the production effect, which needs a day past deploy. TN-79 names the read.
