# 2026-07-20 — Admin device-data capture panel (JSON export + failure catches)

**Branch:** `claude/handoff-documentation-w1ud2j` · Admin R&D (no version bump)

Owner directive: "anything that needs on-device data — build an admin panel so it can record the data
and send in JSON format; create catches for failures so you know what the failure is from."

## What landed

- **`components/admin/data-capture-console.tsx`** — a generic **probe runner**. Each probe is a
  self-contained read of a server route or the native BLE plugin, wrapped in its **own try/catch** so
  one failure never hides the rest and the **exact error** (HTTP status + body snippet, or the plugin
  error) is recorded. "Run all" assembles a single copyable JSON snapshot
  (`{ capturedAt, appVersion, userAgent, results:[{id, ok, ms, data|error}] }`). Adding a capture = add
  one entry to `PROBES`.
  - Server probes (work in `pnpm dev`): HR profile, health trends, readiness, running plan + zone
    targets, Oura BLE freshness, device metrics.
  - Native probes (return data only in the APK, else fail with a clear "APK only" message): BLE plugin
    status, key-present, service-log tail.
- **`app/admin/data-capture/page.tsx`** — admin-gated page (`isAdminUser` → redirect), mirrors the
  `/admin/oura-ble` gate. Linked from the Admin → Tools tab.

## Verification

- tsc + lint clean; full suite green (1882).
- **Admin + device gated:** the actual captures need an admin session (server probes) and the APK
  (native probes) — the panel infrastructure (runner, per-probe catch, JSON assembly, copy) is verified
  by tsc/lint; the native probes are the whole reason it exists (the owner runs it on the S25).

Closes the "admin data-capture panel" item in `docs/superpowers/plans/2026-07-20-cardio-system-remaining.md`.
Remaining cardio: cumulative-stress rollup wiring.
