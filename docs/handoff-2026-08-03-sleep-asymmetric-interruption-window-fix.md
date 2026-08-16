# Handoff — 2026-08-03 · asymmetric sleep interruption dropped the earlier real sleep bout

_Domain: `sleep` (also touches `devices` — the BLE decode/raw-sample path) · Branch:
`claude/sleep-wake-time-adjustment-jp39mz` · PR: #1043, **merged to `main`** (squash, all
required checks green: Lint/Tests/Build/Custom Rules/Migration Check)_

> **Read first:** `projectOverview.md` (Current Status + the `[sleep]` Known-Issues row this
> session added), then `docs/domains/sleep/README.md`, then this file. `docs/oura-ble-operations.md`
> §1 row I23 documents the failure signature for future reference.

## Goal

Owner reported: phone calls woke them up mid-night, and the app recorded a bedtime hours later
than when they actually fell asleep. Ask: find out what the data actually showed, and fix it so an
interruption shows as more awake time rather than a later bedtime.

## Current status

- Build/test: `tsc --noEmit` clean, `eslint` clean on touched files, `vitest run lib/sleep/`
  (20/20) and the DB-backed rollup/sleep suites (`oura-ble-sleep-mid-blip-fold`,
  `oura-ble-sleep-phases`, `oura-ble-sleep-staging-rollup`, `oura-sleep-push-sync`,
  `sleep-session-source-merge`) all green in isolation against the local dev DB. **`pnpm dev` was
  NOT run** — this is a pure backend/algorithm change (no API route, no UI), so there is no
  clickable flow to exercise; verification was unit tests + replaying real production data through
  the patched function directly (see below).
- Device-verified: N/A — no native/safe-area/gesture/notification surface touched. Server-side JS
  only, ships via Railway on merge, no APK rebuild needed.
- CI: PR #1043 fully green (all 5 required checks), merged as `754b60d` on `main`. Android job
  (non-required) also passed, unrelated to this change.

## What shipped

- **Root cause found and fixed:** `lib/sleep/sensing-span.ts` — `denseSensingSpan`'s run-selection
  logic now bridges a substantial dense-HR run into the kept span when it's within
  `DEFAULT_MAX_BRIDGE_GAP_EPOCHS` (12 epochs / 1h) of an already-kept run, **regardless of the
  existing length-ratio test** (`minNeighborRatio`, 0.5). Selection chains (keep the longest run,
  then repeatedly pull in anything close-in-time or comparable-in-length), so more than two
  fragments in one interrupted night still merge into one span.
- New unit test in `lib/sleep/__tests__/sensing-span.test.ts`, built from the **real decoded beat
  shape** of the affected night (26-epoch bout, 3-epoch gap, 80-epoch bout) — asserts the span now
  covers both. All 4 pre-existing calibration tests (07-14, 07-15, 07-21, the 07-09 split-night)
  still pass unmodified.
- `docs/oura-ble-operations.md` §1 gained row **I23** for this failure signature.
- `projectOverview.md`: Current Status bullet + a `[sleep]` Known-Issues row (see "Deliberately NOT
  done" below).
- Journal entry: `docs/overview/entries/2026-08-03-sleep-wake-time-adjustment.md` — has the full
  investigation writeup, including the exact real per-epoch beat counts for the affected night.
- Version bump v1.252.6 → **v1.252.8** (main had independently bumped to 1.252.7 for an unrelated
  PR while this one was in flight; rebased and re-bumped on top rather than colliding).

## Deliberately NOT done

**Last night's own `sleep_sessions` row is still wrong.** The fix is a pure function of
already-decoded input (it changes what future rollups compute), not a data migration — it does not
retroactively rewrite anything already stored. The 08-03/04 night's row still shows `sleep_start` =
00:59 instead of the real ~22:32. `body_hex` for that night is untouched (archival, per the Oura
BLE rules in `CLAUDE.md`), so it's fully recoverable via the **Redecode** button in
`/admin/oura-ble` (owner needs to trigger this themselves — it's session-cookie-gated, no
bearer-token path, so it can't be triggered from a Claude Code session). **The owner said they'd do
this themselves once the fix deployed** — this is not still open work for a future session unless
they report it didn't work.

No sweep was done for **other historical nights** that might have hit the same bug (any night with
a real-but-short pre-interruption bout that failed the old ratio test). Flagged in
`projectOverview.md` Known Issues rather than actioned — no backlog entry filed, since this was an
in-session exempt fix, not a queued item.

## Key decisions (with rationale)

- **Chose a "close-in-time" bridge rule over just loosening `minNeighborRatio`.** Loosening the
  ratio threshold would risk un-fixing the very case it exists for (07-21's evening-activity burst,
  which is short **and** ~4h away from the real sleep). Gating the new rule on *time proximity*
  instead means the existing ratio test still does its job for genuinely distant/unrelated bursts,
  while a real interruption (which by definition can't be far from the sleep it interrupts) gets
  through. This is why the fix adds a new independent admission rule rather than tuning an existing
  constant.
- **`maxBridgeGapEpochs = 12` (1h)** — chosen to sit comfortably under the 2h `GAP_DS` that splits
  nights into separate `sleep_sessions` rows at the clustering stage in `adapter.ts`. Anything this
  close in time cannot be a distinct night by the pipeline's own definition, so proximity alone is
  sufficient proof without needing a length comparison.
- **Verified against real production data, not just synthetic test fixtures.** Fetched the actual
  raw BLE samples (`oura_raw_samples`, tags `0x80`/`0x60`) for the affected night via the
  `claude_ro` read-only DB endpoint, and decoded them **with the repo's actual decoder**
  (`lib/oura-ble/decode.ts`, run directly via `node --experimental-strip-types`, no build step) to
  reproduce the exact `perEpochBeats` array the production rollup computes. This is what turned "a
  plausible theory" into "confirmed exact mechanism, confirmed exact fix" — see the journal entry
  for the full numbers.

## Gotchas / what did NOT work

- **The `oura_heartrate` table's 5-minute bpm readings are NOT a reliable proxy for the beat-density
  signal `denseSensingSpan` actually uses.** Early in the investigation, HR values alone suggested
  the user might have been asleep from ~22:00 (steady mid-50s/60s bpm) — directionally right, but
  not precise enough to pin down the actual algorithm boundary or prove the mechanism. Only decoding
  the raw IBI samples and replicating the exact `perEpochBeats` computation gave a result that
  matched (and explained) the production output byte-for-byte.
- **A raw-row-COUNT proxy from `oura_raw_samples` (without decoding) is also misleading** — the ring
  batches buffered readings into packets of varying size, so row count per 5-min bucket does not
  track beat density at all. Don't reach for it as a shortcut; decode the actual `hr_bpm` arrays.
- **`node --experimental-strip-types <file>.ts`** (Node 22.6+) runs the repo's plain-TS modules
  directly with zero build step — much faster than trying to get `tsx`/`ts-node` installed in a
  sandbox with restricted npm registry access. Useful trick for replaying pure-function repo code
  against fetched data during investigation.
- **Rebasing onto `main` after opening the PR hit a real conflict** in `package.json` (auto-merged
  clean, no version collision there) and `packages/shared/src/changelog.ts` + `projectOverview.md`
  (both did collide — another PR bumped to 1.252.7 while this one was in flight). Resolved by
  re-bumping to 1.252.8 on top. This is exactly the "expect `package.json`/changelog conflicts on
  parallel merges" gotcha `CLAUDE.md` already documents — just noting it recurred here as expected.
- **`update_pull_request_branch` failed with a 422 merge conflict** (as expected, given the above)
  — the correct response per `CLAUDE.md` was a local `git fetch` + `git rebase origin/main`, resolve,
  force-with-lease push. Don't retry the API call; it can't resolve content conflicts.

## Files to look at

- `lib/sleep/sensing-span.ts` — the actual fix; read the updated top-of-file comment block, it now
  documents all three admission rules (comparable-length, close-in-time, and the drops) with the
  real-world case for each.
- `lib/sleep/__tests__/sensing-span.test.ts` — the new test is the clearest worked example of the
  bug shape; the beat array in it is the *real* data from the affected night, not synthetic.
- `docs/overview/entries/2026-08-03-sleep-wake-time-adjustment.md` — full investigation writeup
  with the actual per-epoch beat counts table and the exact before/after window boundaries.
- `docs/oura-ble-operations.md` §1, row I23 — the failure-point-matrix entry for this class of bug.
- `lib/data/postgres/adapter.ts` around line 4822 — the single call site (`clampToDenseSensing`),
  unchanged by this fix, useful context for how the window this function tightens gets built in the
  first place (bedtime events / `0x72`/`0x75` clustering).

## Open questions / blockers

- **Waiting on the owner** to run Redecode on `/admin/oura-ble` for the 08-03/04 night, to confirm
  the fix actually corrects that specific stored row end-to-end (not just in the unit-test/replay
  sense already verified). Not a blocker for anything else — the fix itself is merged and live.
- No other blockers. No backlog entry was needed (in-session exempt fix, not queued work).

## Pickup prompt

```
Read projectOverview.md, then docs/domains/sleep/README.md, then
docs/handoff-2026-08-03-sleep-asymmetric-interruption-window-fix.md.

Context: a phone-call sleep interruption bug was found and fixed in PR #1043 (merged,
lib/sleep/sensing-span.ts) — an asymmetric mid-night interruption (a short real sleep bout,
a brief gap, then a much longer bout) was getting the first bout silently discarded. That
part is done and live in production.

What's still open: the owner said they'd personally trigger Redecode on /admin/oura-ble to
backfill the one specific night (2026-08-03/04) that surfaced the bug, since that requires
their logged-in session and can't be done from a Claude Code session. If they report it
didn't work, or that other historical nights show the same stale-truncated-bedtime pattern,
that's the next thing to investigate — start by reading the "Root cause" and "Verification"
sections of docs/overview/entries/2026-08-03-sleep-wake-time-adjustment.md, which has the
exact methodology (decode real oura_raw_samples via lib/oura-ble/decode.ts run directly with
`node --experimental-strip-types`, replay through denseSensingSpan) for checking any other
specific night.

If nothing has been reported, there's no pending work here — check projectOverview.md's
Known Issues / implementation-backlog.md for what else is queued instead.
```
