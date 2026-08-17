# Handoff — 2026-08-17 · the standing-agent model, and what a live device session found

_Domain: `platform` (also touches `devices`, `sleep`, `app-shell`) · Branch:
`claude/docs-review-agent-setup-3ocl7m` · PRs: #12, #14, #19, #22 merged · #26 open_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/agents/README.md` (the operating model this session created), then
> `docs/implementation-backlog.md` (the queue). This file covers only what *this* session did.

## Goal

Two owner requests: review and reorganise the documentation, and stand up four agent roles meant
to run continuously. The second half — taking the app through a real APK reinstall and Oura
re-sync — was not planned and produced most of the findings.

## Current status

- **Build/test:** `pnpm check:rules` 38 of 38, `npx tsc --noEmit` clean, `pnpm lint` 0 errors
  (122 pre-existing warnings). No application code changed in any merged PR.
- **Device-verified:** the Oura re-sync path was exercised on the S25 for real — ring re-paired,
  694 batches drained, `bytesLeft=0`, device and server cursors matched at ds 37,138,611. The
  emulator job's assertion has **never** run (see below). Nothing else here is device-gated.

## What shipped

| PR | What |
|---|---|
| **#12** | The four standing agents — `docs/agents/README.md`, five cold-start prompts, five batons, rules in `CLAUDE.md`. Plus the doc cleanup: `projectOverview.md` 9,647 → 6,3xx lines, backlog header 397 → 48, 498 journal entries compacted into nine history files, 13 duplicate Q numbers resolved, `agents.md` reduced to a pointer. And two CI guards — `scripts/check-backlog-pointers.js`, `scripts/check-doc-index-size.js`. |
| **#14** | The Android emulator job. Merged, then found unworkable — see below. |
| **#19** | Stable debug APK signing from `ANDROID_DEBUG_KEYSTORE_B64`. Before this, every CI-built APK carried a **different** key, so each install required an uninstall. |
| **#22** | Six findings from the live device session (Q-531 … Q-537) plus the emulator disable and the ring-key documentation. |
| **#26** | Open. Moves Q-536 to the top of the queue to match its own handoff note. |

## Deliberately NOT done

- **The Sentry SDK is not wired.** DSN is in Railway, a read token is in a session env. Deferred on
  purpose so the session that wires it can *verify events arrive* rather than assume — a configured
  DSN and a silently-dropping one look identical.
- **Known Issues was not swept.** 25 entries are marked resolved but 22 still owe something real,
  mostly device verification. Archiving by pattern would bury live work for three clean entries.
- **Q-536 was diagnosed, not fixed.** See the rationale below.
- **The journal compaction kept a recent window loose** rather than folding everything.

## Key decisions (with rationale)

- **The lane seam is file ownership, not subject.** File ownership is what actually causes merge
  conflicts. Lane A owns what decides what is *true*; Lane B what decides how it *looks*.
- **Only the Implementation lanes write code.** BugFix, Tuning and Review all end at a docs-only PR,
  which reduces the collision surface across five concurrent sessions to Lane A against Lane B.
- **Q numbers come from per-agent bands.** The shared pointer is a floor that cannot see an unmerged
  PR. Validated hard: the bands prevented every collision between standing agents today, and **both**
  collisions that did occur came from one-off sessions drawing on the shared pointer.
- **Tuning proposes, never ships.** Scoring drives every recommendation; a bad calibration is hard to
  notice from inside.
- **The emulator job was disabled rather than left red.** A permanently-failing check trains everyone
  to ignore the signal, so the next red — a real migration failure — goes unread.
- **Q-536 was handed to Lane A rather than fixed here.** One unknown is load-bearing and unsettled:
  whether the 2026-07-04 → 08-16 rows were *already* wrong or were **rewritten wrong by the
  2026-08-17 redecode**. Those need opposite responses across 43 nights of real sleep history, and
  `CLAUDE.md` names this class as one that has shipped wrong three times from reading alone.

## Gotchas / what did NOT work

- **An uninstall destroys the Oura ring key.** It lives only in Android SharedPreferences and is
  never logged or synced. The "what you lose" list given before the uninstall covered only the JS
  local store and missed the native side entirely. Recovered from the original `open_oura`
  `key.hex`; there was no other copy. **Never recommend an uninstall without confirming `key.hex` is
  in hand** — now documented in `CLAUDE.md` and `docs/oura-ble-operations.md` §0.
- **The emulator assertion could never have passed.** `getLocalStore(userId)` requires a signed-in
  user, so the local database is never created and the smoke script polls 90 s for a file that
  cannot appear. Steps 1–14 of 15 are proven working on a real runner and should not be rebuilt.
- **`/api/version` is the worst possible readiness probe.** It awaits an outbound GitHub Releases
  call before responding, so a probe against it times out on a perfectly healthy server.
- **`get_job_logs` on a job with a Postgres service is useless for diagnosis** — the service
  container's log dominates the tail. Use `actions_get get_workflow_job` for per-step status.
- **A CI job passing does not prove a secret was used.** The signing step exits 0 when the secret is
  absent. Verified instead by downloading the published APK and reading its certificate subject.
- **`check-backlog-pointers` verifies numbering and tags, not structure.** An insert orphaned
  Q-530's heading from its body — the exact "heading with no body" tell the backlog header names as
  a bad merge — and it was caught by eye, not the check. Worth closing.

## Files to look at

- `docs/agents/README.md` — the operating model, lane contract, Q bands, handoff ritual
- `docs/agents/prompts/` — five paste-ready cold-start prompts
- `docs/agents/state/` — the batons; BugFix's was written by a real session, the rest are seeds
- `lib/data/postgres/adapter.ts:5087` — `toDate()`, the clock-anchor resolution behind Q-536
- `.github/workflows/android-emulator.yml` — disabled, with the Maestro spec on Q-250

## Open questions / blockers

- **Q-536 is unresolved and live.** 43 nights show wrong sleep windows. Four ring clock epochs
  exist; epoch 3 was created at 06:58 on 2026-08-17 by the reinstall and its `ds` range overlaps
  epoch 2's. **Do not run another full redecode** — each re-derives through the current epoch.
- **The database is on a temporary 5 GB volume** (raised from 500 MB during a `disk_full` incident).
  The owner wants it back to 500 MB. Q-534 may achieve that *without touching retention*: 291 MB of
  `oura_raw_samples`' 466 MB is index, not data, and autovacuum has never run on the table.
- **The agent model is unproven.** No session has yet run start to finish from one of the five
  prompts. The lane tie-break for unlisted paths has never been exercised under contention.

## Pickup prompt

> You are picking up the TrainingAI queue after the 2026-08-17 session that stood up the standing-agent
> model and ran a live device re-sync. Check out `main`
> (`git fetch origin main && git remote prune origin && git checkout -B <your-branch> origin/main`).
>
> **Read in this order:** `docs/agents/README.md` — decide which agent you are and read that role's
> section, then its baton in `docs/agents/state/` → `projectOverview.md` (orientation and the live
> Known Issues, including the `disk_full` incident row) → `CLAUDE.md` →
> `docs/handoff-2026-08-17-platform-agent-model-and-device-session-findings.md` (this doc) →
> `docs/implementation-backlog.md`.
>
> **If you are Implementation Lane A, your first action is Q-536** — top of the queue. 43 nights of
> sleep sessions show midday bedtimes. The cause is a ring clock-epoch collision: four epochs exist,
> epoch 3 was created at 06:58 on 2026-08-17 when the app was reinstalled and the ring re-paired, and
> its `ds` range overlaps epoch 2's. `toDate()` at `lib/data/postgres/adapter.ts:5087` resolves
> through `resolveDsToMs(ds, anchors)`; establish whether that resolution is epoch-scoped per row.
>
> **Settle this before any corrective pass:** whether the 2026-07-04 → 08-16 rows were already wrong
> or were rewritten wrong by the 2026-08-17 full redecode. Those need opposite responses and the
> blast radius is 43 nights of the owner's real sleep history. **Do not run another full redecode**
> — each one re-derives every timestamp through the current epoch and may be compounding the fault.
> The ds→UTC path is not generally broken: the newest `measured_at` is 07:38 UTC = 17:38 Brisbane,
> matching the device drain log exactly.
>
> **Constraints you would otherwise rediscover.** Take Q numbers from your own band, never the
> shared pointer — both collisions on 2026-08-17 came from sessions using the pointer. Re-merge
> `origin/main` immediately before opening each PR *and* again before merging; `main` moves several
> times an hour. Resolve `scripts/check-doc-index-size.js` baseline conflicts by **measuring the
> merged files**, never by picking a side. `get_check_runs` returning `total_count: 0` several
> minutes after opening a PR means a stale base, not slow CI. Production is queryable via
> `POST /api/admin/db-query` with `CLAUDE_DB_QUERY_SECRET`, but the `claude_ro` views are row-scoped
> to one user and prune at 30 days — write findings as "the owner's, recently", never system-wide.
>
> **Do not recommend an uninstall of the app to anyone** without first confirming the owner has
> `key.hex` in hand. An uninstall destroys the ring key, which exists only in Android
> SharedPreferences, and the intuitive recovery — re-onboarding the official Oura app — re-keys the
> ring and can force a firmware update that breaks the reverse-engineered protocol.
