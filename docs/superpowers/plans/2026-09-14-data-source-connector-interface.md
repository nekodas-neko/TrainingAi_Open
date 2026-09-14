# Plan: formal `DataSourceConnector` interface + registry

_2026-09-14 (PS-40). Companion implementation to
[`docs/data-source-connector-guide.md`](../data-source-connector-guide.md), which documents the
convention this plan makes explicit and machine-checkable. Read that doc first — §7 is this plan's
starting point, and §1–§6 are the contract every task below has to preserve, not redesign._

## Why

Six data sources exist today (Oura BLE, Health Connect ×2 routes, Polar H10, Renpho scale, Colmi
R09), each re-deriving the same conventions (§3–§6 of the guide) independently by reading the
previous source's code. That has worked at six; it will not scale to a seventh built by someone who
hasn't read all six, or to a future community-contributed connector. This plan formalizes the
convention as a checkable declaration, not a runtime plugin system.

**Explicitly out of scope:** a runtime plugin/sandboxing system, dynamic loading of third-party
code, or anything that changes how data physically arrives (BLE transport, Health Connect record
types). This is a typing/registry layer over the existing ingestion pattern, nothing more.

## Tasks

1. **Add the `DataSourceConnector` type and `HEALTH_SOURCE` registry entries**
   (`packages/shared/src/health/source-connectors.ts`, new file). One object per existing source
   (`oura_ble`, `health_connect`, `scale_ble`, `chest_strap`/`polar_h10`, `colmi_r09`, `manual`),
   each declaring `{ id, tier, isolation, healthSource?, supplies, ingestRoute }` per the guide's §7
   shape. This is metadata only — no behavior change.

2. **A CI check that a new ingest route must declare a connector.** Extend
   `scripts/check-learning-mode-isolation.js` (or add a sibling script) to fail if an
   `app/api/**/samples`-or-similar route's `HealthSource` write has no matching registry entry —
   catches the case an ingestion route ships without the declaration this plan adds. Baseline:
   empty (all six existing sources get an entry as part of this same PR).

3. **Wire the registry into the six existing ingest routes** — not to change their behavior, but to
   have each route reference its own `DataSourceConnector` entry (e.g. for a debug/admin surface that
   lists what's registered), proving the type isn't just theoretical. This task is where the "does it
   actually describe the real routes" check happens — expect the shapes in the guide's §3 to need
   minor correction against real code, not the other way around.

4. **Admin surface: list registered connectors** — a small read-only panel (`/admin` devices tab,
   alongside the existing device consoles per `docs/domains/devices/README.md`'s IA note) that prints
   the registry: id, tier, isolation, which pillars/tables it feeds. Not required for the type/CI
   work to land; can be a follow-up `Keep:` if time-boxed out.

## Non-goals (do not scope-creep into these)

- Renaming or restructuring any existing table (`oura_heartrate`, `body_metrics`, etc.) — the guide
  states the generic tables are the contract; this plan does not touch them.
- Apple HealthKit / iOS support — no iOS build exists (`CLAUDE.md` Canonical Runtime). The registry
  entry shape should not preclude adding `healthkit` later, but building it is not this plan's job.
- Changing the provenance ranking (`source-rank.ts`) — orthogonal, already correct.

## Verification

- `pnpm check:rules` clean, including the new/extended CI check.
- Existing ingest routes behave identically — this is additive metadata, so the route test suite
  (`docs/route-test-fixtures.md`) for all six should pass unchanged.
- No device verification needed — this task touches no BLE/native code.
