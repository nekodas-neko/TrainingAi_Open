# 2026-09-28 — TN-72: a Body Battery re-derive, and the day's computation in one place

The owner approved re-deriving the 84 stored Body Battery days under v6 (TN-72, 2026-09-27). Nothing
could do it: `body_battery_daily` is written only by the live route, for today.

- **Extracted** the route's per-day computation to `lib/health/body-battery-day.ts`
  (`computeBodyBatteryDay`). The route now calls it for today up to now, with behaviour unchanged,
  and its tests pass as before (54/54 across the Body Battery suites). The anchor rule moved with
  it to `lib/health/body-battery-anchor.ts`. `BodyBatteryResponse` is re-exported from the route,
  so no client import changes.
- **Added** `POST /api/admin/rederive-body-battery`. It is admin-only, dry-run by default, handles
  31 days a call, runs sequentially, and walks each finished day midnight to midnight. It keeps
  the anchor each day froze, skips today and days with no stored row, and reports how many days
  move and by how much.

**Mutation pass:** a walk run to "now" instead of the day's end, a re-chosen anchor, no skip for
missing rows, no dry-run gate, and no skip for today were all killed. The control (a 32-day ceiling)
survived.

**Not done:** the production run. It needs an admin session, so it is recorded on TN-72 as a Keep
with the snapshot-first procedure. The stress term uses today's daytime-HRV model for every
re-derived day, because a per-day model is not stored.
