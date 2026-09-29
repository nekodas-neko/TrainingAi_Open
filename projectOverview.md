# TrainingAI — Project Overview

> **Lean index — orient here, then dive.** This file holds the current status, the live Known
> Issues & Risks, and the What's Left To Do list. Nothing else. The per-session journal lives under
> `docs/overview/`; the Document Map at the bottom routes everything else. **Anything the engine
> cannot unblock itself is collected under 🔑 Waiting on the owner**, so it never has to be
> reassembled from a chat.
>
> It is kept lean on purpose, and it has drifted twice. If you are about to append a dated summary
> of what you just shipped, that belongs in your journal entry, not here.

**The documentation flow at a glance:**

| Kind of work | Where it lives |
|---|---|
| **Who does what** | [`docs/agents/README.md`](docs/agents/README.md) — the six standing agents, their authority, and the two-lane file-ownership contract. Read this before starting a session. |
| **Upcoming — ready to build** | [`docs/implementation-backlog.md`](docs/implementation-backlog.md) — a priority-ordered queue; implementer sessions take the top item per the protocol in that file |
| **Upcoming — ideas/findings** | [`docs/planned_upgrades.md`](docs/planned_upgrades.md) — open uplift ideas; they graduate to the backlog once a session writes their implementation plan |
| **Completed — session journal** | `docs/overview/entries/` (current window, one file per PR) then the batched `docs/overview/history-*.md` |
| **Completed — shipped plans/specs** | `docs/superpowers/plans/archive/` and `docs/superpowers/specs/archive/` |
| **Completed — shipped uplift ideas** | `docs/overview/uplift-archive.md` |
| **Architecture reference** | the top of [`CLAUDE.md`](CLAUDE.md) — stack, data model, key files, Oura integration (authoritative, kept current) |
| **Session handoffs** | `docs/handoffs/handoff-YYYY-MM-DD-<domain>-<title>.md` — the **only** handoff convention (there is no root `HANDOFF.md`). `ls docs/handoffs/handoff-*-<pillar>-*.md` finds every handoff for a pillar; the pillar index at `docs/domains/<pillar>/README.md` links the ones that matter. Written via the `handoff` skill — see **Session Wrap-Up** in [`CLAUDE.md`](CLAUDE.md). |

---

## 🔖 Current Status

**Version:** v1.482.0 · **Branch:** `main` · Railway auto-deploys on push to `main`.
**Last updated:** 2026-09-29.

**Recent changes are NOT listed here.** They live in the session journal —
[`docs/overview/entries/`](docs/overview/entries/) for recent work, one file per PR, and the batched
`docs/overview/history-*.md` archives behind it. This section is **current state only**: what is
live, what is broken, what cannot be tested in the sandbox.

Everything this section had accumulated up to 2026-09-27 was moved whole to
[`docs/overview/history-2026-09-27-status-narrative.md`](docs/overview/history-2026-09-27-status-narrative.md)
— 281 paragraphs, 292 KB, 94% of this file. It was a changelog sitting inside the one document every
session reads before it can start. **Do not re-grow it:** a shipped change gets a journal entry and,
if it changed what is true, an edit to the state below — never a new paragraph here.


### 🔴 Security
- ✅ **AI SDK CVE bump done.** `@ai-sdk/google ^3.0.86` (+ `@ai-sdk/openai`, `@ai-sdk/react`,
  `@ai-sdk/provider-utils@4.0.33`), `package.json`/`pnpm-lock.yaml` in sync. No open security items.

### ✅ Local-first reads — operational on-device
The headline goal (every screen paints from local data instantly, then revalidates) works since
session 166's SQLite-open fix. Remaining server-only reads are cross-session aggregates
(`weekly-stats`, `weekly-muscle-sets`, `weights-summary`, `muscle-recovery`), server-computed by
design — they stay on `cachedFetch`.

### 🟡 Derived-score read paths (v1.158.1) — known limitation + prod check
The Readiness/Sleep sparklines (`/api/health/trends`), the Body Battery morning anchor
(`/api/body-battery`), and the Sleep contributor bars (`/api/readiness-score`) now coalesce our own
`oura_daily_derived` scores over the frozen post-re-key Cloud columns (data-efficiency S1/S2/S6, item 3a).
**No backfill** — `oura_daily_derived` only has rows from each persist's start date, so sparklines fill
in from ~2026-07-15 (readiness) / this release (sleep) **forward**; derived `activity_score` stays
Cloud-only-then-null until P-D writes it (the coalesce is already in place for it). **Prod check after
deploy** (the local seed is Cloud-shaped + always fresh, so the frozen-vs-live split can't repro in the
sandbox): open Health → Sleep/Readiness, confirm today-forward sparkline points appear and the
contributor bars render on a BLE night; confirm Body Battery no longer opens at a flat 50.

### 🔵 Device-only (cannot test in the sandbox — requires Samsung Galaxy S25 Ultra)
- [ ] **GPS background-location walk detection** (v1.80.1, APK rebuild): confirm the status card
  renders, "Open Settings" works, the card flips to "Enabled" after "Allow all the time", and a
  real backgrounded walk is detected end-to-end (may be blocked by Android 12+ foreground-service
  restriction — see Known Issues). **Update 2026-07-11:** end-to-end background
  detection is known-broken and owner-reported — the fix is planned as backlog item 1
  (`2026-07-11-ring-triggered-walk-detection-gps-battery.md`); its on-device soak supersedes
  this checklist line.
- [ ] **Android App Links for mobile auth** (APK rebuild): replace the custom
  `trainingai://auth-complete` scheme with a verified `https://…/auth-complete` App Link
  (`android:autoVerify="true"` + `/.well-known/assetlinks.json` with the release-cert SHA-256).
  Defence-in-depth only — the shipped PKCE binding already makes an intercepted token unredeemable.
- [ ] **Offline-sync on-device pass** (Batch A + local-first): v13 migration applies on a fresh
  APK launch; body-weight/supplement/injury writes round-trip through the outbox offline;
  `pullDelta` populates on first open; rest-timer reconciles after suspend mid-rest; a failed
  mutation quarantines after 5 attempts with working Retry/Discard.
- [ ] **Notification verification:** supplement reminder fires at `reminderTime` and cancels on
  toggle-off; workout reminder fires on training days only and cancels on workout start; injury
  amber banner fires when an exercise overlaps an active injury.
- [ ] **Guided interval walk — on-device (v1.158.0):** the config→active→summary flow and the
  server page + save path are dev-verified (authed page 200; a `walk` `activity_log` persisted via
  the web fallback), but the client interaction and the two device-only behaviours are unverified in
  the sandbox. Confirm on the S25: (a) live HR + the fast/slow zone verdict update during the walk
  (sandbox shows "—", no ring); (b) the background interval cues (`lib/walk/walk-cues.ts`) fire with
  sound/vibration at each transition while backgrounded / screen-off (local-notification exact timing
  under Doze can drift a few seconds — acceptable for cues); (c) the walk lands in activity history
  through the local-store path (`getLocalStore` is null on web). Open via Log Activity → Interval walk.
- [ ] **Set-log planned snapshot — native local-store leg** (2026-07-17, migration 126): the
  server + web write paths are dev-DB-verified, but the on-device sync chain (raw SQLite insert,
  `mapSetLog`, `applyDelta`, `RECONCILE_COLUMNS`) runs only on the APK (`getLocalStore` is null in
  the sandbox). Confirm: log a set offline on the S25 → kill/reopen → the set still renders and,
  after reconnecting, the row round-trips with `planned_pct`/`planned_rest_sec` intact through
  `pushMutations` and back via `getSyncDelta`/`applyDelta`; plus a cross-device pull of a web-logged
  set carrying the snapshot. Columns are write-and-store (no UI), so nothing is user-visible.
- [ ] **Run/activity leave-confirmation guard (v1.244.0):** confirm hardware back and bottom-nav
  tab taps mid-run/mid-activity on the S25 show "Leave activity?" and discard on confirm, keep
  recording on cancel — mirrors the already-verified guided-walk/workout equivalents, but this is a
  new call site (`/activity`) never exercised on a real back gesture before.
- 🔄 **Health Connect is no longer dormant** (corrected 2026-08-02). This line used to read "HC is
  dormant… verification items are parked". Q-43 (v1.250.0) made HC a **first-class tier-2 source**:
  it is how every non-Oura user gets sleep, and `saveSleepSession` now stamps provenance through the
  ranked merge. The Tasker ingest route is still the unexercised part. **The HC device check is
  owed** — see the owner checklist in
  [`docs/handoffs/handoff-2026-08-02-platform-batch-queue-drain.md`](docs/handoffs/handoff-2026-08-02-platform-batch-queue-drain.md);
  nothing in the HC path has ever run against a real provider.

### 🟢 Nice-to-have
- **Body Battery model tuning** (v1.66.0): the charge/drain constants are heuristic. A
  `body_battery_daily` snapshot table (migration 100) records daily end value / min-max /
  charged-drained / RHR-HRmax inputs / observed peak HR / sample count / `model_version`. After
  ~1–2 weeks of data, correlate end-of-day battery vs next-day readiness/HRV, swap `220−age` for
  observed max HR, retune constants, bump `MODEL_VERSION`. Methodology: `docs/body-battery-tuning.md`.
- **Manual per-muscle weekly-volume-target editing UI** in program config (the engine already
  auto-seeds targets — Batch 1 in `planned_upgrades.md`).

---

## 🗂️ Document Map

`projectOverview.md` is the lean index (current status + **Waiting on the owner** + What's Left).
**It became one again on 2026-09-27**, when the Known Issues section — 79% of the file — moved to
its own document. The append-only session journal and the batched archives live under `docs/`:

| File | Contents |
|------|----------|
| [`docs/overview/history-2026-09-27-status-narrative.md`](docs/overview/history-2026-09-27-status-narrative.md) | **The narrative `Current Status` used to hold** — 281 paragraphs moved whole out of this file 2026-09-27 (OR-197), 292 KB of the 309 KB it then was. Nothing was edited or dropped, so **date any claim in it against the journal before trusting it**. 152 of the 281 duplicate a journal entry; **129 have no pointer and exist nowhere else**, which is why it was relocated rather than curated |
| `docs/overview/known-issues.md` | **OPEN Known Issues & Risks** — 451 entries, moved out of this file 2026-09-27 (Q-220). Grep it by domain tag: `grep -n '^### .*\[sleep\]' docs/overview/known-issues.md` |
| `docs/overview/known-issues-resolved.md` | **Completed Known Issues** — entries archived out of this file once nothing was still owed (53 moved 2026-08-13). Grep it before concluding something has never been looked at. Striking an issue means *moving* it here — see `CLAUDE.md` Session Wrap-Up step 2 |
| `docs/implementation-backlog.md` | **Upcoming (ready)** — priority-ordered queue; implementers take the top item |
| `docs/planned_upgrades.md` | **Upcoming (ideas)** — open uplift findings, batched by data/structure |
| `docs/overview/uplift-archive.md` | **Completed** — shipped uplift batches split out of `planned_upgrades.md` |
| `docs/overview/entries/` | **Recent journal (uncompacted)** — one file per PR/session (`YYYY-MM-DD-<slug>.md`); read these + the newest history file for "what happened lately". Folded into the batched history by the compaction sweep — see the README there. **Corrected 2026-07-30:** this line said "near-empty (compacted 2026-07-20)" but the directory holds ~179 files from 07-20→07-29 — the compaction sweep is overdue; a future session should run it. |
| [`docs/agents/README.md`](docs/agents/README.md) | **The standing agents** — the four roles, their authority, the two-lane file-ownership contract, the Q-number bands, and the handoff protocol. Cold-start prompts in `docs/agents/prompts/`, live batons in `docs/agents/state/` |
| `docs/overview/status-archive.md` | The 157 dated status notes that had accumulated in this file's Current Status section, archived 2026-08-17. Superseded by the journal; do not add to it |
| [`docs/overview/history-2026-09-08.md`](docs/overview/history-2026-09-08.md) … `history-2026-07-17.md` | **Completed journal (batched)** — sixteen files covering 2026-07-17 → 2026-09-06, folded from 498 + 41 loose entries by the 2026-08-17 and 2026-08-18 compaction sweeps, oldest-first within each. Every entry keeps a `<!-- from: … -->` marker naming the PR file it came from. `history-2026-08-18.md` was started because `history-2026-08-15.md` had passed the ~250 KB rule at 300 KB, and `history-2026-08-24.md` because `history-2026-08-18.md` had, at 326 KB. **The 2026-08-24 sweep folded 57 of 153 loose entries**, and **the 2026-08-25 sweep (LA-25) folded 25 of 191, taking unlinked 59 → 34** — the rest are cited by path from `projectOverview.md`, the domain indexes or an agent baton, and folding a linked entry breaks those citations. `history-2026-08-25.md` was started because `history-2026-08-24.md` was at 223 KB and 25 more entries would have passed the ~250 KB rule. **The 2026-09-06 sweep folded 46 of 320**, taking unlinked to **0** and the directory to **274** — it was run because the directory sat at exactly its 320 total ceiling, and that branch of the check has no BF-36 attribution, so it fails whichever PR is open when the count crosses rather than the one that grew it. `history-2026-09-06.md` was started rather than appending 172 KB to `history-2026-09-01.md`'s 105 KB. **The 2026-09-08 sweep (#947) folded 12 into `history-2026-09-08.md`**, 128 KB, taking the directory to 293 — two days after the 2026-09-06 sweep had taken it to 274, because six sessions filed entries in between. That is the cadence to expect rather than a surprise. **#947 created the file and did not add it here**, which is why this row named `history-2026-09-06.md` as the newest until LA-62 corrected it — a new batch file that the Document Map does not name is one nothing routes a reader to |
| `docs/overview/history-2026-07-20.md` | **Completed journal (batched)** — the 2026-07-17 → 2026-07-20 loose entries, compacted 2026-07-20, newest at top |
| `docs/overview/history-2026-07-16.md` | **Completed journal (batched)** — sessions 2026-07-16 → 2026-07-17, newest at top |
| `docs/overview/history-current.md` | Sessions ~287 → 2026-07-16 (closed batch) |
| `docs/overview/history-newer.md` | Sessions ~217–286 (closed batch) |
| `docs/overview/history-2026-09-08.md` | Journal entries folded 2026-09-08 — the unlinked ones only; anything another doc cited stayed loose in `entries/` |
| `docs/overview/history-newest.md` | Sessions ~209–216 (closed batch) |
| `docs/overview/history-latest.md` | Sessions ~177–209 (closed batch) |
| `docs/overview/history-recent.md` | Sessions ~105–176 + roadmap / version-history tables |
| `docs/overview/history-past.md` | Sessions ~51–104 |
| `docs/overview/history-early.md` | Sessions ~1–50 + legacy architecture appendix |
| `docs/superpowers/plans/archive/` | All completed implementation plans (shipped) — reference |
| `docs/superpowers/specs/archive/` | All completed design specs (shipped) — reference |
| `docs/reviews/` | Full review write-ups that seed backlog items (source material) |
| [`docs/domains/`](docs/domains/README.md) | **Per-pillar entry point — read this first when working in one area.** Eleven indexes (`sleep`, `readiness`, `heart-rate`, `cardio`, `activity`, `workouts`, `nutrition`, `body`, `devices`, `app-shell`, `platform`), each gathering that pillar's code locations, reference docs, open issues, handoffs and gotchas. Its `README.md` holds the boundary rules and the `[domain]` tag convention used by the Known-Issues headings above and by handoff filenames |

**Reference docs:** `docs/module-map.md` (**what shared module/infrastructure already
exists and where** — read before building any new feature or helper; documents the
no-cron-layer scheduling patterns), `docs/oura-ring-data-reference.md` (Oura v2 field
reference), `docs/device-smoke-checklist.md` (on-device verification steps),
`docs/owner-action-required.md` (**everything left that the sandbox can't do** — owner-run
device/APK/data/decision items, grouped by action type; read when asking "what's left"),
`docs/body-battery-tuning.md` (Body Battery model methodology),
`docs/sleep-system.md` (**sleep reference** — staging pipeline, scoring, what's
reliable vs approximate, tuning discipline, open levers; read before any sleep work),
`docs/public-launch-checklist.md` (**things deliberately deferred because the app is
personal-use-only** — read when asked "what needs fixing before going public").

**Runbooks:** `docs/runbooks/db-backup-restore.md` (manual `pg_dump`/`pg_restore`
against Railway, disaster-recovery walkthrough), `docs/runbooks/account-recovery.md`
(password reset via `scripts/reset-password.js` when locked out of both
credentials and Google OAuth).

**When adding a session note:** write a **new file** in `docs/overview/entries/` named
`YYYY-MM-DD-<branch-slug>.md` — do **not** prepend to a shared `history-*.md` (that shared-line edit
was the most frequent multi-PR merge conflict; per-entry files take it to zero). See
[`docs/overview/entries/README.md`](docs/overview/entries/README.md) for the convention and the
compaction chore. **Keep this index to current status, Waiting on the owner, and What's Left** — a
new Known Issue goes in `docs/overview/known-issues.md`, not here, or the 79% grows back. The
compaction sweep folds loose entries into the newest `history-*.md`, starting a new one when it
approaches ~250 KB and adding it to this table.
