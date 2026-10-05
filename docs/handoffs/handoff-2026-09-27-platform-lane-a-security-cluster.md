# Handoff — 2026-09-27 · Lane A: the security cluster, five PRs waiting on the owner

_Domain: `platform` (also touches `devices`, `activity`, `heart-rate`) · Branch: `lane-a/rv197-csp-connect-src` (and four sibling branches, below) · PRs: #1779, #1781, #1784, #1789 open and owner-gated; #1774, #1777 merged_

> **Read first:** `projectOverview.md` (status + Known Issues), then
> `docs/domains/platform/README.md`, then `docs/implementation-backlog.md` (the queue).
> This file covers only what this session did and what it leaves behind.

## Goal

Work the Lane A queue top-down. The head of that queue is a block of eight security and auth
entries from Review sweep 60, so most of this session is that cluster: build each one, verify it,
and stop at the merge because `CLAUDE.md` puts auth/session/security changes in the confirm-first
carve-out.

## Current status

- **Build/test:** every branch below is `tsc` 0, `pnpm lint` 0, `pnpm build` 0,
  `check-test-typecheck` at baseline, Custom Rules **Ran 83 of 83**. #1781, #1784 and #1789 each
  ran the **full suite** (~10,540 passed, exit 0 captured without a pipe). #1779 and #1781 have
  **CI fully green on GitHub** (`get_job_logs` with `failed_only`: 0 failed of 10 jobs).
- **`pnpm dev` was NOT run** for any of them. No API route's request/response shape changed in any
  of these diffs, and the two that touch a route path (`log-calendar-event`) are covered by route
  tests that drive the handler. **A local session should run `pnpm dev` before merging any of
  them** — that is the gate this container could not satisfy.
- **Device-verified: no.** None of this was seen on the S25. All of it is JS/server, so it reaches
  the phone through a normal Railway deploy with no APK.
- **`pnpm start` cannot boot in the cloud container** — the instrumentation hook needs S3
  credentials for the vendored model constants (`SignatureDoesNotMatch (403)`). That is why the
  CSP header in #1789 was verified from `buildCsp(false)` and from the built bundles rather than
  off the wire. **A local session with the real env can read the header directly.**

## What shipped (merged)

| PR | entry | what |
|---|---|---|
| **#1774** | TN-78 | Moderate activity starts at 40 % of heart-rate reserve — as `MODERATE_INTENSITY_FRAC` + `moderateIntensityBpm()` in `packages/shared/src/health/hr-zones.ts`, consumed by the new `packages/shared/src/health/zone-minutes.ts`. **`ZONE_DEFS` is untouched**, and a test pins that. |
| **#1777** | BF-211 | `node scripts/next-schema-number.js` replaces the hand-maintained migration/SQLite pointer table. Pure logic in `scripts/lib/migration-claims.js`; 8 tests. |

## Open and waiting on the owner (mine, this session)

| PR | branch | entry | one line |
|---|---|---|---|
| **#1779** | `lane-a/rv192-registration-email-ownership` | RV-192 | Registering an invited address activated the account with nothing proving inbox ownership. Password accounts start inactive; linking Google clears the password. **CI green.** |
| **#1781** | `lane-a/rv193-refresh-token-in-session` | RV-193 | The Google refresh token was on the session object `GET /api/auth/session` hands to page scripts. Moved to a server-side read in the new `lib/auth/session-token.ts`. **CI green.** |
| **#1784** | `lane-a/rv195-auth-and-social-gaps` | RV-195 ② | A deleted account stayed signed in for up to 7 days. `lib/auth/is-active-refresh.ts` now treats a missing row as deactivation. |
| **#1789** | `lane-a/rv197-csp-connect-src` | RV-197 | `connect-src` ended in `wss: ws:` — dev-only now. Unused `generativelanguage.googleapis.com` dropped. **The cheapest of the four to approve.** |

Three older owner-gated PRs from previous sessions are also waiting: **#1749** (LA-142, a
`DROP COLUMN`), **#1755** (OR-159 + RV-196, native security, needs an APK), **#1672** (RV-190),
**#1671** (RV-191), **#1499** (OR-138).

## Deliberately NOT done

- **RV-195 ① — the mobile sign-in challenge binding.** The entry says `/mobile-signin` sets an
  httpOnly cookie. That page is a **client** component, so it cannot, and Next 15 forbids
  `cookies().set()` during a page render. The route-handler shape that works changes the URL the
  Android app opens → Kotlin → **a new APK**, a cost the entry does not mention. And a Chrome
  Custom Tab shares Chrome's cookie jar, so it is genuinely unclear the binding defends anything.
  **Threat model first, then code.**
- **RV-195 ③ — redacting a pending friend request.** Not symmetric: the addressee must still see
  who is asking, and `rowToFriendship` does not know the viewer. The string the entry says to
  return ("what the requester typed") is **not stored**, so an outgoing pending row would render
  blank. It needs a column → a migration → and a migration ships alone.
- **RV-192 fix 1 — real email verification.** There is no mail-sending path in this repository at
  all. See the owner question below.
- **`pnpm dev`** — see Current status.

## Key decisions (with rationale)

- **TN-78 did NOT ship the change its entry prescribes.** Moving `ZONE_DEFS`' Light floor from 0.6
  to 0.4 also moves `targetsForRunType`, which builds run prescriptions from the same map — a
  recovery run's ceiling would drop from 134 bpm to 106. CI caught it
  (`hr-targets.test.ts: expected 106 to be 134`) after a local run of the edited directory alone
  had passed. One map, two uses wanting different edges → two constants.
- **BF-211 removed the migration pointer because it was provably inert.** `check-backlog-pointers`
  pinned the row to `max(merged) + 1` — measured: setting it to 292 against a head of 289 fails by
  name. So the number could only restate the directory, and the "reservation" it was credited with
  lived in a free-text parenthetical nothing read.
- **RV-193 is not "one line".** `auth()` returns what the session callback built, so deleting the
  line takes the token from the server too. The replacement read has a trap: Auth.js derives the
  decryption salt from the **cookie name**, so a wrong `secureCookie` reads every valid token as
  invalid and kills calendar writes with a plain 401 and nothing in the logs. That pairing already
  existed in `bearer-session.ts` and in a comment in `request-error.ts:106`, so it moved into one
  shared module rather than becoming a third copy.
- **Security items are BUILT, not skipped.** `CLAUDE.md` requires confirmation before *merging* an
  auth/security change, not before building one. Reading it the other way is what left the head of
  the queue inert for days (recorded on #1755).

## Gotchas / what did NOT work

- **The Build job's second step is a separate gate.** `pnpm build` passing is not enough —
  `node scripts/check-test-typecheck.js` runs after it and failed TN-78 on a partial object literal
  that ran fine. **Run it locally before pushing.**
- **Running the suite for only the directory you edited is how TN-78's regression got through.**
  The consumer sat one directory over.
- **`git reset --soft HEAD~2` after a merge commit** throws away the merge relationship. Reset to
  `origin/main` and commit once instead (done on #1779).
- **A stale remote-tracking ref lies convincingly.** An un-refreshed ref reported #1608 as holding
  migrations 284/285 — numbers it had been renumbered off. `next-schema-number.js` fetches for
  exactly this reason.
- **`pkill -f '<pattern>'` matches the shell running it** and returns 144. Kill by PID.
- **`pnpm start` will not boot here** (S3 403 from the instrumentation hook).
- **Version collisions are constant.** `main` took 1.477.8 → .13 during this session. Rebuild
  `changelog.ts` from `git show origin/main:…` and prepend; never splice a conflict hunk.

## Files to look at

- `packages/shared/src/health/hr-zones.ts` — `MODERATE_INTENSITY_FRAC`, and the comment saying not
  to move the Light floor.
- `scripts/next-schema-number.js` + `scripts/lib/migration-claims.js` — how to pick a migration
  number now.
- `lib/auth/session-token.ts` — the `secureCookie`/salt convention, shared by three call sites.
- `lib/auth/is-active-refresh.ts` — the try/catch is what separates "row gone" from "DB outage".
- `lib/security/csp.ts` — `connect-src`, now `isDev`-conditional.

## Open questions / blockers

1. **RV-192, product:** real email verification needs a provider, a secret, a token table and a
   screen. The entry's own alternative may remove the need entirely — **every current user signs in
   with Google, so dropping email-and-password registration would close this for nothing.** Which?
2. **RV-195 ①:** does binding the challenge to the browser defend anything, given a Custom Tab
   shares Chrome's cookie jar? If yes, is an APK cycle acceptable, or is the no-APK variant enough?
3. **#1620's author (`jsboiss`) is owed a reply and none was posted** — commenting on a shared
   surface is confirm-first. The answer: the duplicate detection they proposed already existed, the
   command they asked for now exists and is branch-aware, and their own PR #1608 is the live example
   of why filenames alone were not enough.
4. **TN-70** (`resilience_level`'s two regimes) and the bodyweight-plan question are still parked on
   the owner from earlier sessions.

## Pickup prompt

```
You are the Implementation Agent, Lane A, on nekodas-neko/TrainingAi_Open. Rename this session so
its title is exactly `🚧 Implementation Agent (A) 🟢`.

Read, in this order:
  1. projectOverview.md — status, Known Issues, What's Left To Do
  2. docs/agents/README.md — the standing-agent contract and the lane split
  3. docs/agents/state/implementation-lane-a.md — your baton
  4. docs/handoff-2026-09-27-platform-lane-a-security-cluster.md — this handoff
  5. docs/implementation-backlog.md — the queue

You are running LOCALLY, which the previous session was not. Two things that blocked it are
available to you and should be used before anything else:

  A. `pnpm dev` — the previous session could not run it. Four open PRs are built, CI-green and
     waiting: #1779, #1781, #1784, #1789. Check out each branch, run `pnpm dev`, and exercise
     the surfaces each one touches — sign-in and registration for #1779/#1784, completing a
     workout (which writes a Google Calendar event) for #1781, and any page load for #1789's CSP.
  B. `pnpm start` — it cannot boot in the cloud container (the instrumentation hook needs S3
     credentials). With real env you can start the production build and read the actual
     `Content-Security-Policy` header, which is the one verification #1789 is missing:
     `curl -sI http://localhost:3000/sign-in | tr ';' '\n' | grep -i connect-src`
     Expect NO `ws:`/`wss:` and NO `generativelanguage.googleapis.com`.

ALL FOUR OF THOSE PRs ARE OWNER-GATED — auth/session/security, confirm-first per CLAUDE.md. Do not
merge them. Keep them rebased on `main` (expect `package.json`/`packages/shared/src/changelog.ts`
conflicts; rebuild the changelog from `git show origin/main:packages/shared/src/changelog.ts` and
re-bump, never splice a conflict hunk). Report what `pnpm dev` and the header read showed.

Then work the queue: `node scripts/next-item.js --lane A --all` (`--all` is not optional; the
display truncates READY at 10). Everything at the head of Lane A is still the security cluster and
is either in one of those PRs or recorded as not-buildable-as-written — so the first genuinely new,
non-gated item is LA-138 (the early-deload gate's missing in-deload suppression).

Per item: re-verify EVERY claim in the entry against current `main` before writing code — this is
the highest-value step and this session corrected six entries that were right in their measurement
and wrong in their conclusion. Then implement, mutation-test with at least one deliberately
equivalent control, run the full local gate, remove or amend the backlog entry, add a journal entry
in docs/overview/entries/, re-merge origin/main, open the PR, and merge once the required checks
are green unless the item is owner-gated.

The full local gate, in order — the middle one is the step that is easy to miss:
  npx tsc --noEmit
  pnpm lint
  pnpm build
  node scripts/check-test-typecheck.js     # a SEPARATE Build-job step; passing `pnpm build` is not enough
  pnpm check:rules                          # quote its "Ran N of N", currently 83
  DATABASE_URL='postgresql://postgres:postgres@localhost:5433/trainingai_dev' npx vitest run > /tmp/suite.log 2>&1; echo "EXIT=$?" >> /tmp/suite.log
Never pipe the suite to `tail` — that reports tail's exit code.

Required CI checks: Lint, Tests (a gate over 4 shards), Build, Custom Rules, Migration Check. E2E is
NOT required; read it anyway. The reliable green check is attempting the merge — the run-level
`status` field lags 30+ minutes; read job-level conclusions.

Four things waiting on the owner, listed in the handoff: the RV-192 product question (build email
verification, or drop password registration entirely), the RV-195 ① threat-model question, a reply
owed to issue #1620's author, and TN-70.
```
