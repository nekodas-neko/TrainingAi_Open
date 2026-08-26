# 2026-08-26 — The Colmi R09 in learning mode, and the guard that makes it true (PS-8)

**Branch:** `claude/alternative-ring-testing-jzk8el` · one-off session · plan + one CI check, no
integration code

The owner acquired a Colmi R09 and asked for a deployment plan plus a guarantee: *"are we sure its
data will be read only and wont affect scoring of anything I have going? I basically just want to
ingest the data in a 'learning' mode state."*

## The finding that shaped the design

**The obvious isolation mechanism does not work.** Ranking `colmi_ble` below `oura_ble` in
`HEALTH_SOURCES` would make the per-field merge refuse to let it overwrite an Oura value — and would
not stop it being read. Every scoring read in the app is source-blind:

- `getHrForWindow` (`lib/data/postgres/slices/oura.ts:743`) selects `oura_heartrate` with **no
  source predicate** and hands the rows to `preferStrapBuckets`, which is an **allowlist of exactly
  one value** (`chest_strap`) with everything else falling through untouched. A row stamped
  `colmi_ble` would feed the readiness payload and the body-battery window directly.
- `listBodyMetrics` / `listSleepSessions` / `getOuraDaily` / `getOuraDailyDerived` read whole rows.
  `source_map` is per-field *write* provenance; no read consults it.

Repo-wide, two reads filter `oura_heartrate` by source and both are deliberate (the rollup's `'ble'`
and the comparison adapter). **A row in a shared table is a scored row however it is stamped.** So
isolation has to come from the data never entering those five tables — `oura_heartrate`,
`body_metrics`, `sleep_sessions`, `oura_daily`, `oura_daily_derived`.

## The strongest layer is an omission

Every shared-table write takes `source: HealthSource`, a closed union built from the
`HEALTH_SOURCES` tuple. **Not adding `colmi_ble` to that tuple makes a Colmi write to any shared
table a compile error.** The protection comes from the ladder entry being absent, which means adding
it "just for provenance" is exactly the change that removes the guarantee. Worth stating in the plan
so nobody helpfully adds it later.

## What shipped

`scripts/check-learning-mode-isolation.js`, wired into the Custom Rules job, empty baseline. It
fails on a learning-mode module naming a scoring table or calling a shared writer, on any import
outside its own directory except the comparison adapters, on `colmi` appearing in `HEALTH_SOURCES`,
and on `colmi` appearing in any scoring input.

**It was landed before the integration on purpose** — a guard written after the code is a guard that
can be argued with, and promotion out of learning mode now has to delete a line from this script and
show up in a diff.

**Its first draft was wrong and a probe caught it.** Copying `check-aest-midnight-timezone.js`, it
blanked string bodies as well as comments — so a ladder that *had* been given `'colmi_ble'` passed
silently, and the leak that matters most (a raw ``sql`INSERT INTO oura_heartrate …` `` inside a
string) would have been invisible. It strips comments only now. All four violation shapes were
probed failing, then the tree restored and re-probed clean.

## The R09 specifically

The reference client `tahnok/colmi_r02_client` lists **R02/R06/R10** — the R09 is **not** on it.
A fork (`patmorli/colmi-r09-smart-ring`) targets the R09 and reports the same UUIDs, the same
16-byte framing with a **mod-255** checksum, and the same feature set. That is enough to start and
not enough to build on, which makes Phase 0 — one `0x03` round trip proving transport, framing and
checksum together — the gate rather than a formality.

Sleep is in neither client. Gadgetbridge has it from a separate Wireshark dissection: a port, not a
copy, and Phase 6.

## Deployment shape

No APK. `lib/live-hr/chest-strap-source.ts` already does the full BLE cycle in TypeScript in the
WebView, and the Colmi logs internally so it syncs on app open like the scale rather than needing a
foreground service like the Oura. Ships via Railway; **no uninstall risk to the Oura ring key**.

The migration (Phase 2) was deliberately **not** claimed — Postgres numbers belong to Lane A, and
this was a `PS-` session. Next free was 231.

## Files

- `scripts/check-learning-mode-isolation.js` + `.github/workflows/ci.yml` — the guard
- `docs/superpowers/plans/2026-08-26-alternative-ring-colmi-testing.md` — the deployment plan
- `docs/implementation-backlog.md` — PS-8, `Gate: device`
- `docs/module-map.md` · `docs/domains/devices/README.md` — index rows
