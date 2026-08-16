# Handover — Oura on-device + own-analysis: implementation baton

**Updated 2026-07-21.** The data-requirements audit and the full implementation plan are **done, reviewed,
and on `main`.** This is the single entry point for the agent that **builds** it. It links the docs in
read-order, states where to start, and pins the decisions a new agent must not silently undo.

> Supersedes `docs/oura-on-device-handover.md` (that was the baton for the *audit* — now complete).

---

## Goal / north star (one paragraph)

Make the app **device-primary** (Garmin / Apple-Health pattern): the phone owns raw ring `body_hex` and does
**all** compute including ML; **Railway holds only a compact finished-form backup that never computes** and
the 437k-row raw table is dropped. We **own every metric's interpretation** except two kept Oura models —
**SleepNet** (hypnogram) and **step_counter** (steps). Oura's other models become an **observe-never-feed
oracle deleted at ~T+3 months**; a **Polar H10** is an *intermittent validation spot-check only* (test
instrument, **not** a data source / primary truth / longitudinal record — the ring stays the source of
truth, our math carries longevity). Governing principle: **build once, build right — future-proof +
performance, no easy fixes.**

---

## Start here (first implementer session)

**Take D0 — wire `step_counter` as primary steps.** It's independent, pure server-JS + redecode (no native,
no device-storage risk), fixes a live user-visible over-count bug, and de-risks the "keep step_counter"
decision early. Follow the master plan's D0 scope. Everything else depends on the durability chain (D1) or
the native store (D2); D0 is the clean first ship.

---

## Doc map (read in this order)

| # | Doc | What it is / when to read |
|---|---|---|
| 1 | [`docs/superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md`](superpowers/plans/2026-07-21-oura-ondevice-hybrid-master-plan.md) | **The master plan (D0–D7) — start here.** Read its **Review Outcome block first** (it corrects the phase text). The dependency graph, per-phase scope/gate, and owner-decision table live here. |
| 2 | [`docs/superpowers/plans/2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md`](superpowers/plans/2026-07-21-oura-data-requirements-keep-cull-calculate-matrix.md) | **The foundation** — per-metric provenance, per-raw-tag keep/cull verdict, the backup subset, the durability gap. The plan is only correct where this is; consult per metric/tag. |
| 3 | [`docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md`](superpowers/plans/2026-07-21-oura-raw-on-device-phase-1.md) | **D2 detail** — native `oura_raw.db` + cursor gate + WebView rollup port, task-by-task. **Amended by the master plan's Review Outcome** (neural port = SleepNet + step_counter, dHRV-free; Task 1 tables already exist). |
| 4 | [`docs/superpowers/plans/2026-07-21-oura-raw-on-device-phase-2-durability.md`](superpowers/plans/2026-07-21-oura-raw-on-device-phase-2-durability.md) | **D1 detail** — the six-form offline chain + full-history restore (F1–F4 → Track A/B → cutover → restore). Its own Review Outcome R1–R7 is resolved in the revised breakdown; **pending one more review before code.** |
| 5 | [`docs/superpowers/plans/2026-07-21-oura-decoupling-and-own-models-strategy.md`](superpowers/plans/2026-07-21-oura-decoupling-and-own-models-strategy.md) | **The own-analysis strategy** (own-vs-keep-vs-drop rationale, the oracle-deprecation model, the comparison harness, the steps over-count diagnosis + fix). On `main`. |
| 6 | [`docs/oura-ble-operations.md`](oura-ble-operations.md) + the `oura-native-ble` skill | Pipeline rules, failure matrix, `body_hex`-is-archival invariant, the 1:1 device verification runbook (§4). |
| 7 | [`docs/db-volume-cleanup-handover.md`](db-volume-cleanup-handover.md) | Why this started (Railway volume; raw = 91% of the DB). D4 supersedes its bytea option. |
| — | `CLAUDE.md` | Standing rules — DB / sync / offline / SQLite / BLE + "Oura Direct-BLE". Non-negotiable. |

Backlog entry: `docs/implementation-backlog.md` (the Oura on-device block). Branch: `feat/oura-ondevice-hybrid`.

---

## The sequence (corrected order — see master plan §1 graph + Review Outcome)

| Phase | What | Native? | Gate | Depends on |
|---|---|---|---|---|
| **D0** | step_counter → primary steps + redecode backfill | JS/server | on-device steps sane vs old over-count | — (start here) |
| **D1** | six-form durability chain + full-history restore | JS/server + client | device push→pull→restore proof | server infra ∥ D2; **device gate needs D2** |
| **D6** | Polar H10 spot-check + comparison harness | JS + native strap | harness runs; H10 admin-only (not in pipeline) | — (before D5) |
| **D5** | build our own daytime-HRV, retire dHRV | JS | validate vs **H10 spot-check, not dHRV** | **D6** |
| **D2** | native `oura_raw.db` + cursor gate + WebView rollup (**SleepNet + step_counter WASM, dHRV-free**) | NATIVE + JS | WASM parity under **prod CSP on S25** + cursor loss-free over real nights | (D5 lands first so dHRV never ported) |
| **D3** | silent cutover: read-flip local-first + single-writer flip | JS/server | reads paint local-first offline; **data-presence gate**, not plugin-only; rollback posture | D1 + D2 |
| **D4** | server-raw cutover: pull-to-device + completeness audit + **staged drop** | JS/server + 1 migration | **enforceable gate** (below) + **owner-confirm** | D1 + D2 + **D3** |
| **D7** | delete dormant oracle models + `onnxruntime-node` from serving | JS | H10 harness done; keeps SleepNet + step_counter | D6 (+ ~T+3mo) |

---

## Pins a new agent MUST NOT undo (from the 4-lens review)

1. **Neural port = SleepNet + step_counter (NOT dHRV).** Porting dHRV to WASM then deleting it is build-twice;
   omitting step_counter regresses steps after D3. D5 (own daytime-HRV) lands **before** D2's neural port.
2. **CSP:** add `wasm-unsafe-eval` to the production `script-src` and assert `onnxruntime-web` **instantiates
   under the real prod CSP on the S25** — the parity test runs under Node (no CSP) and false-greens.
3. **Migrations 130 + 137, NOT 136** (136 already claimed; re-verify vs tree AND open PRs at pickup).
4. **D1→D4 is an enforceable gate, not prose:** the raw drop PR is refused without (a) all six forms in
   `SyncDelta`, (b) a device-verified **wipe→restore-proof artifact by commit SHA**, (c) `oura_raw.db`'s own
   reconcile + CI gate, (d) a **fail-closed full-date-range completeness audit**. Single-copy exposure starts
   at **D2**, not just D4.
5. **`body_metrics`/`oura_daily` device push mirrors the per-column `sourceMap` COALESCE merge** — else it
   wipes manual weight / Health-Connect steps.
6. **H10 is a test instrument only** — never a pipeline data source, primary truth, or longitudinal record.

## Owner-gated (post-implementation confirms — do NOT need answering to start)

- **D4 raw drop** (data-dropping → confirm-first; rewrites the CLAUDE.md "never prune `body_hex`" rule in the
  same PR). **O1:** the drop supersedes the bytea migration.
- **O2** the small `cull-after-window` set (`0x73`, raw PPG, atlas bioZ) + its retention window.
- **O3/O4** (adopt step_counter as primary; back up coarse bucket tiers) are engineering calls with a
  recommendation in the plan.

## Device-verification (owner's S25 — sandbox can't exercise)

step_counter totals (D0); native `oura_raw.db` durability + cursor + WASM SleepNet perf (D2); push/pull/
restore round-trip (D1); backup-completeness audit before the drop (D4); local-first offline paint (D3). Run
`docs/device-smoke-checklist.md` + ops-doc §4 for each, or add a NOT-verified Known-Issues row.

---

**Status (updated 2026-07-22):** implementation underway. **D0 + D1 F1/B1 + all Track A server halves
(A1–A4) are merged.** → For the current state, exact next tasks (F3-server, Track B B2–B5, the device-gated
client batch, then D2), the pins-not-to-undo, and how to work, read
**[`docs/oura-ondevice-hybrid-implementer-progress.md`](oura-ondevice-hybrid-implementer-progress.md)** — the
live implementer handoff. (Original planning next-action was D0; that's done.)
