# Handoff — 2026-08-02 · Oura BLE Task 4 merge, Phase 3 doc corrections, and an open architecture question

_Domain: `platform` (also touches `app-shell` — Phase 3/Q-1, and `devices` — the Oura on-device
program) · Branch: `docs/handoff-offline-architecture-review` · PR: none yet (docs-only, about to
be pushed)_

> **Read first:** `projectOverview.md` (Current Status — the 2026-08-02 paragraphs), then
> [`docs/offline-first-target-architecture.md`](offline-first-target-architecture.md) (the owner's
> existing offline-first destination — **read this before acting on anything in this handoff's
> "Open questions" section**, it directly bears on it), then
> [`docs/domains/platform/README.md`](domains/platform/README.md), then this file. For Oura
> on-device specifics, follow `docs/oura-ondevice-hybrid-implementer-progress.md` rather than
> re-deriving from here.

## Goal

Two small, concrete pieces of work landed this session (a PR rebase/merge and a docs note), and
one much larger, **unresolved** question was opened: whether the app's whole architecture
(Next.js + Capacitor) is even right, now that a from-scratch rewrite is on the table. This doc
covers all three, but its main job is making sure the third one — which is genuinely undecided —
isn't lost or mistaken for a direction that's already been chosen.

## Current status

- **Build/test:** `pnpm typecheck` run clean twice (after each rebase of #953's branch). No `pnpm
  dev` run this session — no application code was written or touched, only Kotlin doc comments
  (reverted to a no-op, see below) and Markdown.
- **Device-verified:** No device access this session (cloud sandbox). Everything below that
  touches native/on-device behavior is **explicitly flagged as not device-verified** in the
  relevant PR/doc — see "What shipped."

## What shipped

1. **PR #953 merged** — "Oura BLE Phase 1 Task 4: on-device (ringDs↔utc) clock anchor." Ports the
   server's epoch-aware clock-anchor logic (`insertOuraRawSamples` in
   `lib/data/postgres/adapter.ts`, migration 161's design) to Kotlin
   (`android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt`), so the on-device rollup
   (D2 Task 5, next) can resolve a ring `ds` counter to wall-clock time without a network call.
   Rebased twice across concurrent merges (once onto the #962 revert, once onto an unrelated PR
   #963) before merging — both rebases were clean, no conflicts. Squash-merged at `e7e26159`.
   - **While rebasing, dropped one commit from the original PR entirely.** The branch's third
     commit ("Fix doc-comment path references after the shell/api split landed") had repointed two
     Kotlin doc comments from `lib/oura-ble/clock.ts` to `packages/shared/src/oura-ble/clock.ts`,
     reflecting the (since-reverted) #952 workspace split. Since #962 reverted that split,
     `lib/oura-ble/clock.ts` is the real path again — applying the fix would have pointed the
     comments at a file that no longer exists. Confirmed the edit exactly canceled the original
     commit (`git diff` empty after applying + `git reset HEAD^`), so the commit was dropped
     rather than kept as a no-op.
   - **⚠️ Its own test plan flags: not device-verified.** No Robolectric coverage for the SQLite
     read/write path in this project, so `measured_at` correctness against a real drain has not
     been confirmed on hardware. D2 Task 5 (the on-device rollup port, next) will consume this
     output, so this should be confirmed with a real drain before Task 5 trusts it — see
     `docs/oura-ondevice-hybrid-implementer-progress.md`'s Task 4 note.
2. **PR #964 merged** — docs-only. Added a "post-split update delivery has no OTA path" note to
   the Phase 3 plan doc
   (`docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md`) and the Q-1 backlog
   entry: once the shell is bundled into the APK, every shell/UI change stops being a zero-rebuild
   Railway deploy and becomes a full APK-rebuild + GitHub-Release + manual-sideload cycle (via the
   *existing* `components/more/update-check-card.tsx` → `/api/download-apk` flow — that flow
   already exists and needs no changes, but there is no silent OTA/hot-swap path anywhere in the
   codebase). **Not actioned** — explicitly low-priority, worth doing only if it turns out cheap
   (e.g. `capacitor-updater`).
   - Also corrected a stale line in the same Q-1 entry: it previously read as if the `shell/`+
     `api/` app split (Task 4 Step 3) simply "remains" (untouched). In fact it was attempted
     (#952), broke production, and was reverted (#962) — see below.
3. **`projectOverview.md` and `docs/implementation-backlog.md` updated** (this commit) to reflect
   both merges, correct the same staleness in `projectOverview.md`'s Current Status (which also
   didn't mention #952/#962 at all), and flag the open architecture question below in both places
   so it isn't missed on the next read-through.

## Deliberately NOT done

- **No code for a rewrite, and no new repo.** The architecture question below is unresolved —
  nothing was implemented, scaffolded, or even prototyped toward either "stay on Next.js/Capacitor"
  or "rewrite native." Do not treat the opinion recorded below as a decision.
- **Did not resume the Phase 3 workspace-split infra blocker** (provisioning a second Railway
  service for `api/`, per the Q-1 backlog entry) — deliberately, since spending that owner effort
  is premature while the architecture question is open. See "Open questions."
- **Did not device-verify PR #953's clock anchor.** No device access this session; flagged, not
  silently skipped.

## Key decisions (with rationale)

- **Dropped the stale doc-comment commit from #953 rather than keep it as a no-op.** A no-op
  commit with a misleading message ("Fix doc-comment path references after the shell/api split
  landed") would read as if the split were still live, confusing future `git log` archaeology.
  Cleaner to drop it since the working tree was byte-identical either way.
- **Recorded the architecture-rewrite opinion in this doc rather than only in chat.** The
  conversation that produced it will not be visible to the next session; the reasoning needs to
  survive in `docs/` or it's lost. See "Open questions" below for the reasoning and the follow-up
  research prompt, verbatim.
- **Did not touch the Phase-3 infra blocker this session.** Provisioning a Railway service is an
  owner action with real cost; doing it now would be premature if the owner ends up choosing a
  rewrite instead of continuing Phase 3.

## Gotchas / what did NOT work

- Nothing failed this session — both PRs merged clean on the first attempt after their respective
  rebases. The one thing worth flagging for the *next* rebase of any Oura-BLE-adjacent branch:
  **check for doc comments referencing `packages/shared/...` paths** — any branch that predates
  the #962 revert but was written while #952 was live may carry the same now-stale path reference
  this session found and dropped.

## Files to look at

- `docs/offline-first-target-architecture.md` — **the owner's existing, already-written offline-
  first destination doc (2026-07-30).** Important: it frames the destination entirely in terms of
  the *current* stack (Phase 3 shell-bundling + the Oura on-device program, both within
  Next.js/Capacitor) — it does **not** contemplate a rewrite. The architecture question raised this
  session was not checked against this doc in the conversation that produced it; the next session
  should reconcile the two rather than treat the rewrite opinion as operating in a vacuum.
- `docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md` — Phase 3 plan, now with
  the OTA-gap note (#964).
- `docs/implementation-backlog.md` — Q-1 entry, now corrected re: #952/#962 and flagged re: the
  open architecture question.
- `android/app/src/main/java/com/trainingai/app/oura/OuraRawDb.kt` — the merged clock-anchor code
  (#953).
- `docs/oura-ondevice-hybrid-implementer-progress.md` — live state of the Oura on-device program;
  D2 Task 5 (rollup port) is next once Task 4 is device-verified.

## Open questions / blockers

**The big one: is Next.js+Capacitor the right architecture at all, or should this be rewritten
from scratch?** Raised by the owner this session, directly prompted by watching #952 break
production. Framing: the app is single-user, Android-only (S25 Ultra, sideloaded, no Play Store, no
iOS — see CLAUDE.md's "Canonical Runtime" section), and already committed to an offline-first
destination (`docs/offline-first-target-architecture.md`). Given that, and given the app is about
to undergo more infra rework regardless, the owner asked whether now is the time for a design
change — possibly starting fresh on a new repo.

**This session's opinion (a starting position to stress-test, not a decision):** full native
rewrite — Kotlin + Jetpack Compose + Room (SQLite) + WorkManager for sync — keeping Postgres/Railway
only as a thin sync/backup/AI-proxy backend. Reasoning offered:
- Android-only kills the usual case for any cross-platform framework (Capacitor, Flutter, React
  Native) — there's no second platform to amortize the abstraction cost against.
- The existing Oura BLE integration (`android/app/src/main/java/com/trainingai/app/oura/`) is
  *already* native Kotlin, reverse-engineered at real cost. A Compose rewrite keeps it in place
  untouched; Flutter or React Native would tax it with a platform-channel/bridge layer for no
  benefit.
- A meaningful fraction of CLAUDE.md's documented pain is intrinsically a WebView problem: floored
  safe-area CSS utilities because there's no real WindowInsets bridge, hand-rolled gesture
  direction-locking because there's no real native gesture system, SVG-wipes-sibling-gradients
  compositor bugs, nested-`<button>` stripping. Real native widgets don't have these failure modes.
- The offline-sync design already built (mutation outbox, cursor-paginated pull-delta,
  cache-invalidation groups) is a set of *concepts*, not React-specific code — it maps onto Room +
  WorkManager directly, so it's a port of a design, not a green-field reinvention.
- The explicit cost acknowledged: a full UI rewrite (every screen), and **permanently losing the
  zero-rebuild instant-deploy-over-Railway property** — the exact same tradeoff surfaced in the
  #964 OTA note, except applied to the whole app instead of just the bundled shell.

**⚠️ This opinion was not reconciled against `docs/offline-first-target-architecture.md`,** which
is an existing *owner directive* (2026-07-30) that frames the offline-first destination entirely
within the current stack — it explicitly sequences Phase 3 and the Oura on-device program as the
path there, with no mention of a rewrite. The next session should not treat the rewrite opinion as
if it exists independently of that doc; either the offline-first doc needs revisiting in light of
the rewrite question, or the rewrite question needs to be weighed against how much of that doc's
already-decided sequencing would be thrown away.

**A follow-up research prompt was written and given to the owner in chat** (not committed anywhere
until now) for a separate fresh agent to independently validate or refute the rewrite opinion.
Recording it here verbatim so it isn't lost if the owner didn't save it:

<details>
<summary>Research prompt for a fresh agent (click to expand)</summary>

```
I want an independent, well-researched architecture recommendation for a personal Android app — not
implementation, not code, not a new repo. Just a written comparison and a clear opinion, backed by
actually reading this codebase, not assumptions.

## The app

TrainingAI: a personal gym/health tracker. Single user (me), Samsung Galaxy S25 Ultra, sideloaded APK
only — no Play Store, no iOS, no other users. Read CLAUDE.md at the repo root first; it documents the
current architecture, hard-won gotchas, and a "Canonical Runtime" policy stating the S25 Ultra APK is
the only supported target.

## Current stack

Next.js 15 + React 19 + TypeScript, wrapped in a Capacitor WebView that (today) loads a remote
Railway-hosted URL rather than bundling assets into the APK. PostgreSQL on Railway via Drizzle is the
backend. There's a substantial offline-first local layer already built: a local SQLite store on-device
(Capacitor SQLite plugin), a mutation outbox with cursor-paginated pull/push delta sync, and a cache-
invalidation-group system (`lib/cache-groups.ts`). Read `docs/module-map.md` for the actual shape of
this. There's also a hand-reverse-engineered native Kotlin BLE integration for an Oura Ring 5
(`android/app/src/main/java/com/trainingai/app/oura/`, skill: `oura-native-ble`) — this was expensive
to build (protocol reverse-engineering, epoch-aware clock anchoring, a durable raw-sample store) and
is genuinely hard to redo from scratch.

## Why this question is live right now

There's an in-flight project ("Phase 3: bundle the shell into the APK",
`docs/superpowers/plans/2026-07-28-native-feel-phase-3-bundled-shell.md`, backlog entry Q-1 in
`docs/implementation-backlog.md`) aimed at making the WebView feel more native by bundling a Next.js
static export directly into the APK instead of loading it remotely over the network. The first
attempt at the required workspace split (PR #952, splitting into `shell/` + `api/` apps) broke
production immediately and had to be reverted (PR #962) — the split works around real friction:
Next's `output: 'export'` can't cleanly serve an app where 105 of 195 API routes need server-side
`auth()`.

Separately, we identified a real tradeoff even if Phase 3 succeeds: today, UI/shell changes deploy
through Railway with zero APK rebuild — only rare native Kotlin changes need a rebuild + reinstall.
Once the shell is bundled into the APK, *every* UI change becomes a rebuild-and-sideload cycle
(there's an existing in-app update mechanism — `components/more/update-check-card.tsx` +
`/api/download-apk`, backed by a GitHub Release the CI already publishes — but it's manual
tap-to-download, not silent OTA; there's no `capacitor-updater`-style hot-swap anywhere).

Given the app is already getting a heavy infra rework, the question became: is Next.js+Capacitor even
the right architecture for a single-user, Android-only, offline-first app that wants real "Swift-like"
native feel — or should this be rebuilt from scratch on a different stack now, while a rework is
already underway?

## A starting opinion to stress-test, not defer to

In an earlier conversation I (a different Claude session) recommended going fully native — Kotlin +
Jetpack Compose + Room (SQLite) + WorkManager for sync — keeping Postgres/Railway only as a thin
sync/backup/AI-proxy backend, on the reasoning that: Android-only kills the case for any
cross-platform framework; the existing Oura BLE code is already native Kotlin and a cross-platform
framework (Flutter, React Native) would tax it with a bridge/platform-channel layer for zero benefit;
a lot of CLAUDE.md's documented pain (floored safe-area CSS because there's no real WindowInsets
bridge, hand-rolled gesture direction-locking, WebView compositor bugs wiping sibling gradients,
nested-`<button>` stripping) is intrinsically a WebView problem that disappears with real native
widgets; and the offline-sync design (outbox, cursor-paginated delta pull, invalidation groups) is a
transferable *concept*, not React-specific code — it maps onto Room + WorkManager directly. The stated
cost: a full UI rewrite, and losing the zero-rebuild instant-deploy-over-Railway property permanently.

**Don't just accept this** — pressure-test it. Look at the actual scope (how many components/screens
exist under `components/` and `app/`, how deep the sync/outbox logic really goes, how large/coupled
the Oura BLE Kotlin code is) before agreeing a full rewrite is proportionate. Consider alternatives
seriously, e.g.: Kotlin Multiplatform (if there's ever a plausible iOS future — check whether that's
actually been discussed/wanted anywhere in the docs, e.g. `docs/domains/README.md` or
`projectOverview.md`), Flutter, staying hybrid but reverting Phase 3's local-bundling ambition and
optimizing the current WebView instead, or something else entirely.

**Also read `docs/offline-first-target-architecture.md` before concluding anything** — it's an
existing owner directive (2026-07-30) that frames the offline-first destination entirely within the
current Next.js/Capacitor stack, with Phase 3 and the Oura on-device program as the sequenced path
there. Your recommendation needs to either fit within that directive or make an explicit case for
revisiting it — don't produce a recommendation that silently ignores it.

## What I want back

A written recommendation (not code, not a new repo, not a plan doc unless you think that's the right
deliverable format) that: states a clear top recommendation with reasoning, names the alternatives you
seriously considered and why you ruled them out, gives an honest scope/cost estimate for what a
rewrite would actually touch (grounded in this repo's real size/shape, not a guess), and is explicit
about what would be thrown away vs preserved (especially the sync design and the Oura BLE code) under
each option. If you think starting a fresh repo now is wrong and an incremental path is better, say so
— I'm not committed to a rewrite, I'm trying to find the right call before more infra work goes in.
```

</details>

**Other pre-existing blockers, unaffected by this session:**
- Phase 3 Task 4 Step 3 infra blocker (second Railway `api/` service) — see "What shipped" above.
  Should stay paused pending the architecture question, not resumed reflexively.
- Oura on-device D2 Task 4's device-verification gap (this session's #953) — needs a real S25 drain.
- The pre-existing D1 restore-proof check (More → profile → "Restore from cloud" on the S25) is
  still outstanding per the backlog Q-29 entry — unrelated to this session, noted here only because
  it's in the same neighborhood and easy to bundle into a future device session.

## Pickup prompt

```
Check out `main` (this session's docs land via a docs-only PR off `main`, no long-lived branch to
resume). Read, in order: `projectOverview.md`'s Current Status (the 2026-08-02 paragraphs on Phase 3
and the open architecture question), `docs/offline-first-target-architecture.md` (the owner's
existing offline-first destination — written assuming the current stack, not a rewrite), then
`docs/handoff-2026-08-02-platform-offline-architecture-review.md` (this file) in full.

The single most important thing to know: the owner is questioning whether to continue with
Next.js+Capacitor at all, versus a from-scratch native rewrite (Kotlin + Jetpack Compose + Room +
WorkManager), after PR #952 broke production attempting the Phase 3 workspace split (reverted as
#962). **Nothing has been decided.** This handoff's "Open questions" section has the full reasoning
for a native-rewrite opinion floated in the prior session, and a ready-to-paste research prompt
(also in that section) for having a separate agent independently validate or refute it — that
research has NOT been run yet as of this handoff.

First concrete action: ask the owner whether (a) they want you to run that research prompt now (as
a background Agent task, so you can keep doing other things), (b) they've already decided based on
the prior conversation and want you to start scaffolding a chosen direction, or (c) they want to
resume the paused Phase-3 workspace-split infra blocker (provisioning a second Railway service for
`api/`) on the assumption the current stack continues. Do not resume the Phase-3 infra blocker on
your own initiative — it was deliberately left paused pending this decision, since provisioning that
service is wasted owner effort if the app moves off this stack.

Constraints to keep in mind: this project is Android-only (Samsung S25 Ultra, sideloaded, no Play
Store) per CLAUDE.md's Canonical Runtime section — a fresh session unfamiliar with that framing might
otherwise default to considering cross-platform options that don't apply here. Any device-only
verification (the #953 clock-anchor gap, the Phase-3 auth/safe-area work, anything native) needs an
owner-run on-device pass — this sandbox has no Android SDK/device access. If a PR is opened for this
work, it needs to go through the standard CI/CD PR workflow in CLAUDE.md (subscribe to PR activity,
merge policy per change type).
```
