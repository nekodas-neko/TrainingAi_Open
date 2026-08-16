# Handoff — 2026-08-08 · Agent-2 UI/cache run through the 2026-08-07 review backlog

_Domain: `app-shell` (also touches `workouts`, `activity`, `devices`, `platform`) · Branch:
`feat/home-device-battery-chips` (last of 16) · PR: [#1178](https://github.com/nekodas-neko/TrainingAI/pull/1178) **merged** — all 16 are on `main`, nothing in flight_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> [`docs/domains/app-shell/README.md`](domains/app-shell/README.md), then
> [`docs/implementation-backlog.md`](implementation-backlog.md). This file covers only what *this*
> session did. Its dispatch parent is
> [`docs/handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md`](handoff-2026-08-07-cross-full-app-review-backlog-dispatch.md).

## Goal

Work the "Agent 2" half of the 2026-08-07 full-app-review backlog — the UI/cache side — while a
second agent held the platform/sync/security side in parallel. Territory was explicit: `components/`,
`lib/cache-groups.ts` and what the items' own text called for; **never** `lib/data/postgres/adapter.ts`
or `app/api/workout-data/route.ts`.

## Current status

- **Build/test:** `tsc --noEmit` clean · `eslint` 0 errors · full suite **414/414 files, 3270/3270
  tests** · all nine custom-rule scripts pass (one of them new, see below).
- **Device-verified: NO — nothing in this session ran on the S25.** Everything was verified against
  `pnpm dev` + Playwright at the 412×915 viewport. Two carry more risk than the rest and are flagged
  in `projectOverview.md` Known Issues:
  - the **48dp tap floor** is a CSS change touching every control under 640px; five screens were
    measured (Home, More, Nutrition, Config, session-select), **guided-walk, the in-progress workout
    screen, health and overview were not**;
  - **Q-123's offline write path** is structurally unreachable in the sandbox — `getLocalStore`
    returns `null` there, so only the API fallback branch executed.

## What shipped

Sixteen PRs, all squash-merged. Versions ran v1.270.x → **v1.270.30**.

| PR | Item | What |
|---|---|---|
| #1140 | Q-119 | light-mode `--color-brand` + `--brand-foreground` |
| #1145 | Q-120 | `normalizeMuscle` in `getWeeklySetsByMuscleGroup` |
| #1149 | Q-127 | chart.js import chain — **negative result, see below** |
| #1151 | Q-121 | 1 Hz re-renders → `components/workout/workout-clocks.tsx` |
| #1152 | Q-126 | five cache-invalidation gaps in `lib/cache-groups.ts` |
| #1153 | Q-125 | route `Cache-Control` defeating invalidation |
| #1157 | Q-136 pt1 | mechanical dead-code deletions only |
| #1158 | Q-135 | memos defeated at their call sites |
| #1156 · #1166 | **Q-133 closed** | `aria-expanded` ×12; then 48dp floor, `ConfirmDialog` ×4, emoji chrome, `chat.tsx` `bg-page` |
| #1165 | **Q-132 closed** | light-theme literals, duplicated palettes, colour-only bands |
| #1167 | **Q-123 closed** | offline write path + timezone day key in the review sheet |
| #1169 | **Q-95-followup closed** | in-flight auto-detection teardown |
| #1171 | **Q-97-followup closed** | COMPLETED stamp + the hue bug it exposed |
| #1175 | **Q-109-followup closed** | Deload moved off Home |
| #1176 | **Q-148 closed** | client components can read the user's timezone |
| #1178 | Q-111 ring half | battery chip pointed at the live BLE source |

New shared modules: `packages/shared/src/health/score-band.ts` → `scoreBandByLabel`,
`packages/shared/src/health/body-battery-band.ts`, `packages/shared/src/date-utils.ts` →
`msToHHMMInTz`, `components/shell/user-timezone-provider.tsx`,
`components/health/score-band-legend.tsx`, `components/workout/completed-stamp.tsx`,
`components/workout/deload-toggle.tsx`, `components/workout/use-deload-choice.ts`,
`components/workout/workout-load-error.tsx`. New CI ratchet:
`scripts/check-color-mix-hue.js`.

### Four findings that contradicted the review — recorded, not papered over

1. **Q-127's cold-start cost does not reproduce.** Identical chunks and bytes before and after;
   webpack had already isolated chart.js behind `health-content`'s own `dynamic()` boundary. The PR
   is a negative result plus the dead-code half.
2. **Q-133's "21 toggles" is an overcount.** Several are Radix `CollapsibleTrigger`s, which emit
   `aria-expanded` themselves. A **rendered-DOM audit** put the real number at 12.
3. **Q-132's "SVG ring frames on Home" pointed at the wrong file.** The frames had been split out of
   `oura-score-chip-row.tsx` into `components/home/score-ring-frames.tsx` the day before and the line
   numbers followed. In the light theme the four Home scores had **no ring at all**.
4. **`/stats` is not dead** — `session-select-content.tsx:455` pushes to it from a wired control.
   Only the orphaned content component was removable.

### The biggest find: `color-mix(in oklch, …, <achromatic>)` renders the wrong hue

Building the COMPLETED stamp, the plate came out **salmon pink** in light mode. Measured in Chromium
rather than reasoned about:

```
color-mix(in oklch, oklch(0.72 0.19 149) 18%, oklch(1 0 0))  ->  oklch(0.9496 0.0342 26.82)
                               ^ green, hue 149°                                    ^ hue 27° — PINK
color-mix(in oklab, oklch(0.72 0.19 149) 18%, oklch(1 0 0))  ->  oklab(0.9496 -0.029 0.018)  ✅
```

oklch is polar, so mixing interpolates the **hue angle**; white's chroma is 0 and its stored hue is
0. CSS Color 4 calls such a hue "powerless" and says to carry the other colour's — **Chromium does
not do that for `color-mix`.** **26 shipped sites** did exactly this across More, Profile, trophy
case, title picker, Oura section, goal spectrum, the set cards and session-select. It hid because the
app was dark-only: against near-black the same wrong hue sits at very low lightness and reads as
grey. All 26 → `in oklab`; the **129 mixes against `transparent` were never affected** (alpha
compositing preserves hue) and are untouched.

## Deliberately NOT done

- **Q-133's "move the tap floor into `components/ui/button.tsx` variants".** Checked first: every
  `Button` size declares *less* than the floor (`sm` 32px, `default` 36px, `lg` 40px, `icon` 36px) and
  most controls are hand-rolled `<button>`s a variant would never reach. The move would **shrink
  coverage, not tidy it**. The global rule stays, with a comment saying why. `<a>` stays excluded —
  an inline prose link is not a tap target.
- **Q-136's four deletions** (`app/health/timeline`, `sync/oura-timeseries`, `oura/webhooks`,
  `/sheet/[id]/*` shims) — owner decisions, left alone.
- **~8 `toAestDay(cutoff)` calls** in Q-148: query-window math on 14/30/90-day lookbacks, not
  display. Re-keying them churns caches for nothing visible.
- **Q-111's strap and scale halves** — strap needs JS wiring to a native value nothing reads; the
  scale has no battery capability at all. The entry stays open for them.
- **No back-fill** of `activity_logs.start_time`/`end_time` rows written before Q-148. They hold
  `DEFAULT_TZ` clock strings, which for the owner is the same value.

## Key decisions (with rationale)

- **`in oklab`, not a new token or a wrapper.** Same perceptual space, rectangular coordinates, so
  there is no hue to interpolate — a one-word fix at every site, and a ratchet stops it returning.
- **Q-95-followup discards rather than ends.** `endSession()` finalizes into `pendingSessions`, which
  **is** the confirm sheet — ending on abort would cause the popup being removed. Hence a new
  `discardSession()`.
- **Deload left Home entirely** (owner-confirmed), which forced `aiDeload` from a URL param into live
  state via `useDeloadChoice`. The old URL entry point still works.
- **Q-148 reads the session in the root layout**, not per screen: the one place that already has it
  server-side, so the value is in the first render with **no mounted gate** — a gated read paints a
  wrong first frame, the exact class being removed.
- **Q-111 shows staleness rather than hiding it.** Past 3h the percentage is muted and the label says
  how old it is. Hiding repeats the Cloud chip's failure in the other direction.
- **Paid for hotspot growth by extracting** (Q-138's own guidance): `workout-screen.tsx` breached its
  ratchet at 1878/1861, so `WorkoutLoadError` came out and the baseline was **shrunk to 1850** so the
  gain cannot be spent later.

## Gotchas / what did NOT work

- **Verification caught two placement bugs that review would not have.** The Deload toggle first sat
  inside the `prescription-exists` branch — which would have left **no way to pick Deload before a
  prescription is generated**, exactly what Home's button covered. And Q-148's `stats-grid` site is
  unreachable with the seed (the tenure branch wins), so the provider was proven a different way.
- **Two zones are not enough to prove a timezone fix.** Device-local and the `DEFAULT_TZ` fallback
  are indistinguishable unless all three differ. Used user `America/New_York`, device `Europe/London`,
  fallback `Australia/Brisbane`; `2026-08-01T02:00:00Z` rendered `31 July`, which only New York gives.
- **A blanket `sed` on version strings clobbered another PR's reference** in `projectOverview.md`.
  Caught and restored. Don't sed version numbers globally.
- **Version collisions happened three times** with a parallel agent merging fast. The fix that works
  is the documented one: rebuild `changelog.ts` from `git show origin/main:…` and prepend — **never
  splice the conflict hunks**, which drops the `version:`/`date:` header when the conflict falls
  inside a `changes:` array.
- **`git merge origin/main` after a `reset --soft` left rebased *copies* of main's commits**, so
  `origin/main` was no longer an ancestor. Tell-tale: `git merge-base --is-ancestor origin/main HEAD`
  fails while the log looks right. Fix: `git diff origin/main > p.patch`, `git checkout -B <branch>
  origin/main`, `git apply p.patch`.
- **`pkill -f "next dev"` kills the shell running it** (the pattern matches its own command line).
  Kill by PID from `pgrep -af next`.
- **Two dev servers fighting over `.next`** produce `ENOENT middleware-manifest.json` and a 500 on
  every route. Kill all, `rm -rf .next`, start one.
- **Login rate limit is 20/email/15min** and Playwright burns through it. Restarting the dev server
  resets the in-memory limiter.
- **Probe routes must not start with `_`** — Next treats `app/__x/page.tsx` as a private folder and
  404s it.

## Files to look at

- `scripts/check-color-mix-hue.js` — the new ratchet; verified to fail on a planted regression.
- `scripts/check-timezone-rendering.js` — `BLOCKED_ON_CLIENT_TZ` is now **empty**, deliberately kept
  with the reasoning; its comment records that the check's scope (`toLocale*String` only) is
  **narrower than the bug**.
- `scripts/check-component-size.js` — `workout-screen.tsx` baseline is now 1850.
- `components/shell/user-timezone-provider.tsx` — `useUserTimezone()`, the thing that did not exist.
- `components/workout/use-deload-choice.ts` — why `aiDeload` is state, not a param.

## Open questions / blockers

- **Device verification (S25).** Nothing here ran on hardware. It also blocks Q-104, Q-116 and Q-114,
  none of which can start without a `chrome://inspect` capture.
- **Score-calibration decisions:** Q-72 (Sleep Score), Q-137 (Activity Score), Q-147/Q-149
  (`rest_adequate` measured 100% true — anything keyed on it is keyed on a constant).
- **Q-136's four delete-or-keep calls.**
- **Q-111's refresh-button question** — the entry establishes the header button is strictly narrower
  than pull-to-sync (it doesn't bump `refreshTick`), which supports removing it, but discoverability
  of a gesture vs a visible button is a real counter-consideration. Not resolved.
- **Q-85** needs both a planning session and a prescription-quality call from the owner.

## Pickup prompt

**The two-agent split ended with this session.** The prompt below is written for a **single agent
owning the whole queue** — there is no territory restriction any more, and both halves' handoffs
(this one and `docs/handoff-2026-08-08-platform-review-backlog-drain-and-production-audit.md`) are
now history rather than live coordination.

```
Continue the TrainingAI implementation backlog on nekodas-neko/TrainingAI, as the ONLY agent —
the two-agent territory split (components/ vs adapter.ts) ended on 2026-08-08. You own the whole
queue; there is nobody else to stay out of the way of.

Follow CLAUDE.md exactly: one feature branch per item cut fresh from origin/main, the full gate
(tsc --noEmit, eslint, vitest run, plus `pnpm dev` exercising every changed route and UI flow),
and the journal entry (a NEW file in docs/overview/entries/) + projectOverview.md update +
backlog-entry removal + version/changelog bump all bundled into that SAME PR. Re-confirm base
currency immediately before merging. Merge without asking once CI is green and the change is
tested — except destructive/irreversible changes (data-dropping migrations, auth/session/security,
secrets), which are confirm-first.

Read in order:
  1. projectOverview.md — current status and the live Known Issues table
  2. docs/domains/<pillar>/README.md for whatever you end up working in
  3. docs/handoff-2026-08-08-app-shell-review-backlog-ui-batch.md (the UI/cache half)
  4. docs/handoff-2026-08-08-platform-review-backlog-drain-and-production-audit.md (the platform half)
  5. docs/implementation-backlog.md — the live queue and the source of truth

=== FIRST: three housekeeping items, in this order ===

1. The standing session-start production read (CLAUDE.md) — error_events prunes at 30 days, so a
   fault that stops on its own vanishes unrecorded:

     curl -sX POST https://trainingai-production.up.railway.app/api/admin/db-query \
       -H "Authorization: Bearer $CLAUDE_DB_QUERY_SECRET" -H 'Content-Type: application/json' \
       -d '{"sql":"SELECT url, source, left(message,120) AS message, count(*) AS hits, max(created_at) AS latest FROM claude_ro.error_events WHERE created_at > now() - interval '"'"'7 days'"'"' GROUP BY 1,2,3 ORDER BY hits DESC LIMIT 30"}'

   Anything new gets a projectOverview.md Known-Issues row or a backlog entry the SAME session.
   If any server row now carries a `[pg …]` prefix, that is Q-107's missing evidence and Q-107
   becomes the top item: 57014 = statement_timeout (chase the slow query); no code at all means a
   pool-acquisition timeout, i.e. the max:10 pool is the constraint (chunk getSyncDelta's fan-out).
   Do NOT build Q-107's batching fix without one of those two answers.

2. **PR #1174 has a live Q-number collision — fix it before merging.** It is docs-only, open since
   2026-08-08 12:13, and files its sleep_score finding as **Q-150**. But Q-150 on main is already
   taken by the running-app review (the signed-out sign-in page firing 12 API calls). Renumber
   #1174's entry to **Q-153** (the next free number per the backlog header), fix its "Next free Q
   number" line, rebase onto current main, and merge. Per the backlog's own rule, the standalone
   entry moves and the in-flight stream keeps the number — here the sign-in item is the one already
   on main, so #1174's is the one that moves.

3. **PR #1143 (Q-141, AI chat drops the chart on a "show on a chart" follow-up)** has been open
   since 03:38 that day. Check whether its base has drifted; either finish it to green and merge,
   or say why it should not land.

=== THEN: work the queue top-down ===

Skip anything gated. As of 2026-08-08 the READY items, in queue order, are:

  Q-150  sign-in page fires 12 authenticated API calls, all 401, incl. a POST /api/oura/sync.
         Root-caused already: two unguarded effects in components/sync-provider.tsx (cache warm
         at :115 and :159, maybeSyncOura at :194/:225/:232). Gate both on userId as the push/pull
         phases already are, and check the resume listener. Small, high value — this fires on
         EVERY signed-out route because SyncProvider is mounted in the root layout.
  Q-151  a second live React #418 hydration mismatch, on /sign-in. React #418 is the
         highest-count production error (153 in 30 days); Q-73 fixed only the home instance.
         NOT root-caused — the reproduction is the hard part and it is written down. Suspect
         anything reading Date/localStorage/matchMedia/navigator during render, and the
         theme/resolvedTheme mounted-gate pattern.
  Q-152  ensureSchema logs a real migration failure identically to benign idempotency notices,
         then continues. Small diff; classify what it swallows.
  Q-143  getOuraClockAnchors() re-reads the whole anchor table on every rollup.
  Q-145  errors from the 80 catch-less routes are recorded with no user at all.
  Q-7b   the ten device-owned oura_daily_derived columns have no producer — the exact list is in
         its entry. This is the largest ready piece of real work in the queue.
  Q-114 / Q-104  the two scale items (progress-bar drift; toast firing on a plain Home visit).
  Q-42   extract the readiness composite so Body Battery can compute it.
  Q-1a   client bearer auth + apiUrl() — explicitly marked startable now.
  Q-138  component-size hotspots — its own entry says take these opportunistically when you are
         already in the file, not as a dedicated PR.

GATED — do not start these without the owner:
  - Owner decision: Q-71 (ring-time anchors), Q-72 (Sleep Score calibration), Q-137 (Activity
    Score calibration), Q-4 (respiratory rate), Q-136's four remaining deletions
    (app/health/timeline, sync/oura-timeseries, oura/webhooks, the /sheet/[id]/* shims),
    Q-105-followup, Q-91-followup. Q-102 is owner-DECLINED — do not re-raise it.
  - Needs the S25: Q-147 (cold app start has never been measured), Q-34's remaining items,
    Q-29's D2 verification.
  - Needs its own planning session first: Q-85 (no plan doc exists), Q-112 (spec-sized),
    Q-44 (phases 2/3).
  - Blocked on other work: Q-93-followup waits on Q-110's screen; Q-111's strap and scale halves
    need native Kotlin work (its ring half shipped 2026-08-08).
  - Q-49/Q-50 (public repo migration) need an owner infra action.

=== Constraints that would otherwise be re-discovered ===

- Q numbers and versions collide. Claim a Q number against the backlog file AND the open-PR list,
  never the "next free" counter — it has gone stale within the same day, repeatedly (#1174 above
  is the live example).
- Resolve package.json / packages/shared/src/changelog.ts conflicts by rebuilding from
  `git show origin/main:packages/shared/src/changelog.ts` and prepending your entry. NEVER splice
  the conflict hunks — when two PRs bump the same day the conflict falls inside an entry's
  `changes:` array and a splice silently drops the other PR's version. This corrupted the
  changelog three times on 2026-08-08.
- `get_check_runs` returning total_count: 0 right after a push is propagation delay. It is only
  the stale-base tell several minutes in. Use the GitHub MCP tools for all CI/PR state — a bash
  curl to api.github.com is NOT authenticated in this environment.
- Nothing shipped on 2026-08-08 has been verified on the S25. The two worth checking first if a
  device becomes available: the 48dp tap floor (app/globals.css — it touches every control under
  640px, and only five screens were measured) and Q-123's offline write path (structurally
  unreachable in the sandbox — getLocalStore returns null there). Also still unverified: the
  supplements local-SQLite v22 migration from Q-124 — if the owner reports supplements behaving
  oddly, suspect that first.
- Commit or stash before every `git checkout`, and prefer `git add <paths>` over `git add -A`.
  A dirty-tree checkout silently carries modified files across and the next `add -A` commits them
  onto the wrong branch — this happened twice on 2026-08-08.
```
