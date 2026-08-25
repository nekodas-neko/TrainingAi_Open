# Handoff — 2026-08-25 · the baseline zero-seed, and a twelve-PR Lane A sweep

_Domain: `readiness` (also touches `platform`, `nutrition`, `sleep`, `devices`) · Branch: `chore/lane-a-handoff` · PR: opened with this doc_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/readiness/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what *this* session did and what it leaves behind.
> Previous readiness handoff: [`docs/handoff-2026-08-24-readiness-scores-owner-batch.md`](handoff-2026-08-24-readiness-scores-owner-batch.md).

## Goal

Work the Lane A queue top-down. It turned into one substantial thread — the personal-baseline
engine seeding at zero — plus a spread of platform correctness items.

## Current status

- **Build/test:** full suite green on every merged head (last: 4783 passed, 51 skipped, 0 failures).
  `pnpm check:rules` — Ran 56 of 56. `tsc --noEmit` clean, `pnpm lint` 0 errors.
- **`pnpm dev` was never run.** It failed early on a missing `@sentry/nextjs` and I did not retry
  after `pnpm remove` repaired the workspace. **Every claim here rests on tests, not on a running
  server** — which for the read-path changes below is a real gap, not a formality.
- **Device-verified: NO. Nothing in this session was seen on a device.** The sleep and readiness
  changes are read paths on screens the owner opens daily.
- **Production `error_events`: none in the 12 h after the last deploy.**

## What shipped

Twelve PRs merged. Migrations **212–215** are mine; next free is **216**.

| PR | Entry | What |
|---|---|---|
| #421 | TN-3a | `oura_daytime_stress_buckets` (mig 212) + claude_ro rebuild (213). Rows not JSONB; `bucket_start` is the instant, so a timezone change cannot strand it |
| #423 | Q-300, Q-293 | Rest-adherence measurement; **every cached AI insight served stale all day** — only `daily-digest` of fourteen sections wrote a context hash |
| #424 | Q-296, Q-292 | `ai_call_log.model` was the constant `AI_MODEL_ID`; `PROSE_GUARDS` for the five prose routes |
| #435 | Q-288 | `/api/export` covered 26 of 82 tables. Pagination first, then coverage, enforced by `scripts/check-export-coverage.js` |
| #437 | Q-274 | `/api/day-log` picked `value[0]` from a date-ordered query — nap vs night **by coin flip** on 15 dates |
| #441 | Q-285 | Web-push deleted whole (mig 214 drops `push_subscriptions`, 215 rebuilds claude_ro). **Verified in production:** table gone, 85 views, both migrations applied |
| #444 | BF-13, Q-506, TN-8 | **The session's real find** — see below |
| #450 | TN-6a | Temperature readiness penalty suspended while its baseline is uncentred, on a self-clearing condition |
| #455 | LB-9 | Atwater factors folded from four copies to one |

Earlier in the session: #396 (Q-530), #417 (TN-2 refactor), #419/#420.

### The baseline zero-seed (#444), which is what to understand first

`updateBaseline` starts from `meanX8 = 0` and anneals toward the sample at a step size that
collapses to 1/32 after fourteen nights. The first reading landed the mean at **half** its value and
it never caught up: night 2 of the owner's temperature history read **17.905 °C** against a 35.81 °C
sample, and at night **fifty** the baseline was still **0.363 °C low** — 2.8 nightly sd. One
corrupted intermediate was failing four consumers: the readiness penalty ladder, the illness radar's
`tempZ`, the "body temp elevated" deload card, and TN-8's chronic-stress fever mask.

The fix is `seedOrUpdateBaseline`, a **wrapper**. See *Key decisions*.

## Deliberately NOT done

- **The baselines have NOT been re-derived.** The seed fixes everything built from here; the owner's
  stored baselines are still zero-folded, and **every pass test in the BF-13/Q-506/TN-8 batch
  measures the re-derivation, not the code**. No new code is needed — `run.ts:917` null-seeds the
  fold under `fullHistory`, and the **Redecode** admin endpoint already sets it, so one run does it.
  **It cannot be run from a sandbox** (the rollup needs the vendored Oura constants Q-49 removed).
- **TN-6a is a suppression, not a fix.** TN-6 must retire it; its ±0.05 °C pass test is what does.
- **Q-292's prose guards are prompt text** — the tests prove the instruction arrives, not that the
  model obeys. Re-run the 117-insight audit in a few weeks; if superlatives or Fahrenheit survive,
  stop asking and post-check the output deterministically.
- **The two night-selection implementations were not converged** (`sleep-night.ts` vs
  `lib/sleep/merge-sessions.ts`). They agree on this history; converging changes the owner's main
  sleep surface and wants a device check.
- **No full export run against production.** `oura_heartrate` + `rr_intervals` are 46 MB of table
  and inflate as NDJSON; memory is bounded now, but a request timeout is untested.

## Key decisions (with rationale)

- **The baseline seed went in a wrapper, not in `updateBaseline`.** My first attempt put it inside
  and broke `warm_up_then_settle` — **ported verbatim from open_oura's own test**, pinning
  `updateBaseline(null, 100, 0) === 400`. The zero start is ecore's ground truth; changing it makes
  the port a lie about what the ring does. BF-13 predicted this trap and it still caught an attempt.
- **TN-6a's suspension is a computed condition, not a dated comment.** Suspended while the trailing
  mean deviation is outside ±0.15 °C or under 10 nights exist. A Redecode lifts it with **no
  deploy** — which is what makes shipping it ahead of the re-derivation safe.
- **Thresholds were never widened** (TN-6a, Q-506, TN-8, BF-13 all refuse it): it hides a broken
  input behind a plausible firing rate and permanently desensitises a real fever.
- **Export coverage is a map + CI check, not a longer array.** Deliberately NOT driven from
  `generate-claude-ro-views.js` — its views scope to one fixed owner, the export scopes to the
  requester; coupling them puts both on one blast radius for no shared behaviour.
- **`oura_heartrate` and `rr_intervals` ARE exported** despite their size — readings taken from the
  user's body are the least omittable thing in a health takeout. Raw BLE frames are excluded, written down.
- **A legacy NULL context hash counts as a cache MISS** — precisely the row that cannot be vouched for.

## Gotchas / what did NOT work

- **⚠ An `aria-hidden` overlay makes `getByRole` report an affordance as ABSENT, not obscured.** I
  filed LA-22 claiming an E2E test could never have passed because "no such button exists", reasoning
  from a local reproduction plus a grep. Wrong: Home's Morning Check-in modal was covering it, and
  #456 had already fixed it. **A grep appears to confirm the false conclusion.** The entry is
  corrected; what survives is that **E2E is not a required check** (#454 merged with its own E2E red).
- **Four existing tests were pinning bugs rather than guarding.** The breathing baseline asserted
  `meanX8: 580` — exactly half of 1160 — with a comment claiming it "pins the ×10 units". Read a
  failing test before adjusting it; several were asserting the defect.
- **A backlog conflict has two opposite shapes and identical markers.** Both sides *deleting* their
  finished entry → keep neither (resurrection). Both sides *inserting* a new entry → keep both. Read
  the headings.
- **Rebuild `doc-size-baseline.json` from `origin/main`; never splice its hunks.** I spliced once and
  silently reverted three other agents' baseline raises.
- **A stale base cost three CI cycles** across `check-component-size`, the doc-size ratchet and Lint,
  each time looking like a real failure. Merge `origin/main` before believing a CI failure is yours.
- **`pnpm remove` repaired the workspace as a side effect** — the two long-standing `qrcode` test
  failures were a missing package, not a bug.

## Files to look at

- `packages/shared/src/health/personal-baseline.ts` — the vendor port and `seedOrUpdateBaseline`
- `packages/shared/src/health/temperature-baseline-health.ts` — TN-6a's self-clearing condition
- `lib/export/export-map.ts` + `scripts/check-export-coverage.js` — export coverage, default-deny
- `lib/ai/insight-cache.ts` — the only read path for `ai_health_insights`; no hash-less read exists
- `lib/oura-ble/rollup/run.ts:917` — where `fullHistory` null-seeds the fold (the re-derivation)

## Open questions / blockers

1. **Run Redecode on production.** Owner action. Then check: deviation mean within ±0.05 °C with
   ~half the nights negative; `temp_dev_c > 1.0` on **0** nights (TN-8); and re-measure the biomarker
   table — every z moves ~19× and the radar may then fire **too often** (Q-506).
2. **Should E2E be a required check?** (LA-22, gated on owner.)
3. **Nothing device-verified this session.**

## Pickup prompt

```
You are the standing Implementation Agent (Lane A) for nekodas-neko/TrainingAi_Open.
Rename this session so its title is exactly `🚧 Implementation Agent (A) 🟢` — use get_session
with session_id omitted to get your own id, then set_session_title.

Read in this order:
  1. CLAUDE.md (standing rules — especially Canonical Runtime and the CI/CD PR workflow)
  2. docs/agents/README.md and docs/agents/state/implementation-lane-a.md (your baton)
  3. projectOverview.md (status + Known Issues)
  4. docs/handoff-2026-08-25-readiness-baseline-seed-and-lane-a-sweep.md (this file)
  5. docs/domains/readiness/README.md

Then, at session start: read production `error_events` and the database size via
POST /api/admin/db-query (the queries are in CLAUDE.md).

First concrete action: run `node scripts/next-item.js --lane A` and take the top READY entry.
Do NOT hand-scan the backlog — the script is the authority on what is startable.

Constraints you would otherwise rediscover:
- Migrations 212–215 are used; **next free Postgres migration is 216**. Local SQLite v28.
- Your next entry ID is **LA-23** (verify with
  `grep -rhoE '\bLA-[0-9]+\b' docs/ | sort -t- -k2 -n | tail -1`).
- **The BF-13/Q-506/TN-8 batch is code-complete but its data half is NOT done** — the owner must run
  Redecode on production to re-derive the baselines. Until then every pass test in those three
  entries is unmeasured. Do not mark them shipped.
- **TN-6a is a suppression that TN-6 must retire.** Do not treat its ✅ as the end of the matter.
- **The rollup cannot execute in this sandbox** (needs the vendored Oura constants Q-49 removed), so
  anything requiring a rollup pass is owner-only. `pnpm dev` had a missing `@sentry/nextjs`; retry it
  before assuming it is still broken.
- **Merge discipline:** re-merge `origin/main` immediately before opening each PR *and* again before
  merging, and rebuild `docs/doc-size-baseline.json` from `origin/main` on a conflict rather than
  splicing hunks. A stale base is the most common cause of a CI failure that is not yours.
- **Nothing from the previous session was device-verified**; sleep and readiness read paths changed.
```
