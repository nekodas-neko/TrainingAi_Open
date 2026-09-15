# 2026-09-14 — a generic data-source connector contract, and six concrete gaps it found

**Branch:** `claude/generic-datasource-connector-ybe9tc` · one-off session (docs-only, no lane).
Owner request: a generic connector structure so a second user's own ring/strap/phone can feed the
app, and — since it touches how every score is calculated — a clear picture of what data each pillar
actually needs and where it comes from.

## What shipped

All docs, no code — deliberately, per the backlog-driven-implementation rule (design now, build
later, tracked as backlog entries rather than built inline):

- **[`docs/data-source-connector-guide.md`](../../data-source-connector-guide.md)** (new) — the
  contract a new data source is checked against. Traced from the real code, not written from
  intent: the canonical shape of every data type (HR as a time-series list, sleep as a
  session-plus-stage-interval array, body metrics as sparse daily scalars), which calculation reads
  which field and what it does when a field is absent (§4 — readiness and sleep score genuinely
  degrade gracefully; chronic stress, resilience, Body Battery and the OTS training-stress score have
  no fallback at all today), the decode→normalize→write pipeline the Oura rollup already implements
  (§5, formalized rather than newly designed), a metric-by-metric classification of what the Oura
  ring's firmware computes for us versus what the app computes itself from lower-level signal (§5.6),
  and the full Layer-1 input list the app needs for every pillar to work at full strength (§13).
- **[`docs/sync-health-api-reference.md`](../../sync-health-api-reference.md)** (new) — the actual
  JSON request/response contract for `POST /api/sync-health`, taken directly from its Zod schema:
  field names, types, nullability, value bounds, and the plausibility rules that can skip one record
  without failing a batch. Written because "connect your own device" turned out to need something
  code-shaped, not another design doc.
- **[`docs/superpowers/plans/2026-09-14-data-source-connector-interface.md`](../../superpowers/plans/2026-09-14-data-source-connector-interface.md)**
  and **[`...-apple-healthkit-ios-connector.md`](../../superpowers/plans/2026-09-14-apple-healthkit-ios-connector.md)**
  (new) — two buildable implementation plans, the second mirroring the real Health Connect sync
  field-by-field so an implementer isn't re-deriving the pattern.
- Six backlog entries (**PS-40 through PS-46**) filed for what the research pass actually found
  broken or missing, each with file/function evidence rather than a bare claim — see
  `docs/implementation-backlog.md`. Two are small and self-contained (PS-41: Health Connect's HR
  series is read but never normalized into the table Activity Score depends on; PS-42: illness
  radar's own formula degrades gracefully but its caller never invokes it for non-Oura users). Four
  are owner-gated decisions, not implementer tasks (PS-40: a typed connector registry; PS-43: Health
  Connect's 30-day backfill cap is a client heuristic nobody decided on purpose; PS-44: a working
  rMSSD-from-raw-beat-intervals calculator already exists and is only wired to workout summaries —
  swapping it into the live scoring path needs a validation pass first; PS-45/PS-46: no per-user API
  key exists for external device integration, and the Apple HealthKit connector needs a real Apple
  Developer account before it can start).
- Linked all of it from `docs/module-map.md` and `docs/domains/devices/README.md` so the next
  session touching a device integration finds it without being told where to look.

## Verification

- `pnpm check:rules` — **75/75 Custom Rules steps pass**, including the doc-link and orientation-doc
  size checks this session's own additions tripped (two broken relative links inside the new plan
  docs, and the backlog file's size baseline needing a ratchet — both are fixed in this branch, with
  the baseline raise recorded in `docs/doc-size-baseline-history.md`).
- `node scripts/check-index-doc-paths.js` and `node scripts/check-backlog-pointers.js` run clean
  after every addition across the session, not just at the end.
- No `pnpm dev` run — this PR touches no runtime code, so there is nothing to smoke-test on the local
  dev server. Every factual claim in the new docs (table names, function signatures, decode logic,
  formula inputs) was checked against the actual source via targeted research passes, not written
  from memory — per `CLAUDE.md`'s external-field-name rule, applied here to the app's own code
  rather than a third-party API.

## What this session deliberately did NOT do

- **No code changes.** Every finding became a backlog entry or a plan doc, not an inline fix — this
  is a planning session under the repo's own backlog-driven-implementation rule.
- **No decision was made on the owner's behalf.** PS-43/PS-44/PS-45/PS-46 all state a recommendation
  and the reasoning, but stop short of building, because each changes either a live score's input, a
  new authentication surface, or a real recurring cost.
- **Not device-verified**, because nothing device-specific was built. The one existing-code claim
  worth flagging for a future session to re-confirm on real hardware: PS-44's premise that
  `rmssdFromRr()` already runs correctly on live Polar-strap data — verified by reading
  `compute-workout-hr.ts`'s wiring, not by watching a live rest-window HRV number update on a strap.
