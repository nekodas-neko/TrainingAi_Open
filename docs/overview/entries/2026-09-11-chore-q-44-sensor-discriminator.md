# 2026-09-11 — 73% of `oura_heartrate` is a Polar chest strap (Q-44's second requirement)

**Branch:** `chore/q-44-sensor-discriminator` · one backlog entry amended. No product code.

## The question behind it

The owner asked to replace `oura` with `sensor` in the table names **and** *"make sure we know which
sensor somewhere, so we can use the same tables for other recording devices"*. The first half has
been queued as Q-44 since 2026-08-02, with a written Phase-3 plan since 2026-08-04. **The second half
was not in either.**

## What production says

`oura_heartrate.source`, measured:

| `source` | rows | period | what it is |
|---|---|---|---|
| `chest_strap` | **84,246** | 2026-07-17 → now | Polar H10 |
| `ble` | 19,376 | 2026-07-06 → now | Oura ring, direct BLE |
| `workout` / `awake` / `rest` / `live` | 12,494 | 06-22 → **07-06 only** | Oura Cloud, dead era |

**The table named after one vendor is 73% another vendor's.**

An earlier draft of this called the column *overloaded* — device names mixed with context names. That
was wrong, and the backlog already said so 5,000 lines away: the four context-looking values are Oura
**Cloud** series types from the pre-BLE era, and that era's last row is 2026-07-06. The discriminator
works for everything current. Recorded because the wrong reading is the intuitive one.

## The actual gap: coverage

**5 of 22 vendor tables carry a `source` at all** — `oura_heartrate`, `rr_intervals`, `oura_workouts`,
`oura_tags`, `oura_daily_derived`. The other 17 do not, and **`oura_bucket` is among them** — the
intraday rollup a second device would most need to share.

So renaming `oura_bucket` → `sensor_bucket` on its own buys a portable-looking name and no
portability, which is worse than the honest vendor name: it invites the next writer to assume a
guarantee the schema cannot deliver.

Q-44 now asks for a **column audit beside the rename**, per table: does a second source ever write
here (→ needs `source`), or is it structurally single-device (→ keep the vendor name, as
`oura_raw_samples` already does, because it holds reverse-engineered frames of one ring's firmware).

## Not done

No rename, no column added. Q-44 is Lane A and carries real regression risk — its own plan names the
trap, that `sync-engine.ts` dispatches on domain *strings* and an already-installed APK keeps sending
the old ones until reinstall. This records the requirement the plan was missing.

**Surfaces not exercised:** none apply — one backlog entry; no runtime code, no device path, no
schema. `pnpm check:rules` **Ran 73 of 73**.
