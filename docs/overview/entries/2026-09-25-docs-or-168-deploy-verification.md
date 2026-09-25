# 2026-09-25 — OR-168 filed, and a lifecycle I misread three times

**Branch:** `docs/or-168-deploy-verification` · **Lane:** O · docs-only

## The correction first, because it is mine

`OR-163` recorded that the Device Verification agent was **archived** and treated it as a gap, twice
noting its title still ends in 🟢 "so the session list reads as though it is live". The owner
corrected it: **DV runs locally on his machine, so archiving when idle is its normal lifecycle.**
*"Its just inactive until its needed."*

I flagged it three separate times as a blocker on his top-priority item. It never was. The
generalisable part is that **the same signal means different things for a container session and a
local one**, and nothing in the session list distinguishes them — so a role's lifecycle is not
readable from the outside, and reading it as a defect is a guess wearing the clothes of an
observation. The entry now says so and says not to file it again.

## OR-168 — post-deploy verification, notify-only

Merging to `main` auto-deploys to Railway and **nothing checks the result.** The 2026-08-17 outage —
a database-free route unreachable for ~8 minutes — was found by the owner noticing. There is no
`railway.json` and no healthcheck.

The owner chose **notify-only over automatic rollback**, and the reason is worth keeping: an
automatic revert across a migration can leave production worse than the bad deploy did. A check that
tells you beats no check; a check that *acts* is a mechanism that can itself fail.

## Two findings that kill the obvious implementation

The naive version — poll `/api/version` until it reports the merged version — **does not work**, and
both reasons were found by reading the route rather than assuming it:

**`/api/version` cannot identify a deploy.** Its `version` comes from `CHANGELOG[0].version`, so it
moves only when a PR bumps the changelog. Most merges do not and a docs PR never does, so the poll
would sit green against the *previous* deploy. `nativeBuildSha` is the APK's sha, not the web one.

**The route is `Cache-Control: public, max-age=300`** — deliberately, as the single written exemption
in `check-api-no-store.js`. A poll can read a five-minute-old answer and confirm a deploy that has
not happened. The fix is to bust it from the caller, **not** to remove the header.

What makes it work: `RAILWAY_GIT_COMMIT_SHA` **is** available at runtime and already used —
`app/sw.js/route.ts:12` keys the service-worker cache on it. Expose it as `webBuildSha`, poll for
that.

The entry also refuses to pick a timeout. `DV-14` measured production serving 1.465.10 while `main`
was at 1.465.16, so deploy lag is real and unquantified — **measure it first**, or the first false
alarm teaches everyone to ignore the alarm.

## Verification

`pnpm check:rules` — Ran 78 of 78. `check-backlog-pointers` — OK, 499 entries. Docs only; the route
change itself is Lane A's and is not in this diff.
