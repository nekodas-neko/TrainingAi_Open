## Oura on-device D2 Tasks 2+3 — device verification passed, gate cleared (docs-only)

The Oura on-device program's one blocking owner action — sideload/rebuild the APK, drain the ring,
kill-mid-drain — has been sitting open since 2026-07-27. Owner ran it on the S25 today: a Full
re-sync drained 694 batches clean ("drain complete: batches=694 bytesLeft=0"), and the
kill-mid-drain test (force-closed the app partway through a second drain, reopened) resumed with a
monotonically-advancing cursor, no gaps, no repeats, and no errors — batches kept committing "N of
N" cleanly on both sides of the reinit point ("ingest URL configured" marks where the app
restarted).

Two sub-checks from the original ops-doc §4 runbook (`getUnrolledRaw`/`markRolledUp`,
`rawStoreOpen`/`lowDisk`) turned out to have no admin-console UI to run directly — `lib/oura-ble/plugin.ts`
defines the bridge methods but nothing in `app/admin/oura-ble/` calls or renders them. Filed as a
new small backlog item (Q-33) rather than blocking on it; inferred passing from the "batch
committed locally" log lines themselves (an unopenable raw store silently falls back to the old
server-gated cursor per ops-doc I22, which would not produce those log lines at all).

**Docs-only — updated the tracking chain:**
- `docs/oura-ondevice-hybrid-implementer-progress.md` — top status note, DONE table, the "🔧 D2
  Tasks 2 & 3" section (was "device verification outstanding", now records the evidence and the
  two UI-gap caveats), and the owner's S25 checklist item 4.
- `docs/implementation-backlog.md` — Q-29 (was "blocked on one owner action", now "gate cleared,
  Tasks 4-9 next"), the "Oura on-device — live handover" ordered list item 1, and new Q-33 for the
  missing admin-console raw-store-status panel.
- `projectOverview.md` — the D2 Tasks 2+3 Known-Issues row marked ✅ resolved with the evidence, and
  the Current Status offline-first-consolidation paragraph updated to say the gate passed rather
  than "in progress."

## Next

D2 Tasks 4-9 (clock anchor, the actual on-device rollup port, neural WASM models, tier-ladder,
prune, storage readout) are unblocked. Not started this session — this PR is the bookkeeping only.
