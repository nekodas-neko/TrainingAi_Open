# 2026-08-15 — one TTL per cache key, enforced rather than asked for (Q-242)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.307.3

Q-242 was filed as the smallest item in the 2026-08-14 review: `day-log:` fetched with a literal
`TTL_MEDIUM` at one site and `DAY_LOG_TTL` at another, equal values, nothing broken, one import
swap. Its own text said not to stop there — *"re-run the whole-repo scan for the same shape rather
than fixing only this key."* That is where it stopped being small.

## What the scan found

**`day-log:` has three call sites, not two.** `app/health/day/day-detail-content.tsx:86` already used
`DAY_LOG_TTL`; only `health-content.tsx` was unconverted.

**`hr-profile` had the same shape with *unequal* values, and the review missed it.**
`HR_PROFILE_TTL` is `TTL_LONG` (6 h) and seven call sites import it;
`components/health/observed-hr-card.tsx` passed a raw `TTL_MEDIUM` (30 min). That is not hygiene —
it is the last-writer-wins freshness split the rule exists to prevent, live in the tree. Safe to
converge upward: `hr-profile` is in two invalidation groups (`lib/cache-groups.ts:212`, `:307`), so
the passive TTL is a backstop, not the freshness mechanism.

**`workout-data:` carried two expressions for one key** — a local `const TTL = TTL_LONG` alias at
one site in `components/workout-screen.tsx` and `TTL_LONG` directly at the other. Same value; the
alias is deleted so the key reads one way.

**The sync-provider warm list is clean.** All 20 warmed keys agree with their fetch sites. Worth
recording because it is a third place a key's TTL is set and nobody had checked it.

## The scan is now a CI check, because that is the actual finding

Three divergences existed under a rule that has been written down since session ~104 and has a
whole constants file built for it. Prose plus a naming convention was not holding it, exactly as
§5 of the review argues for the theme-token rule. `scripts/check-cache-ttl-divergence.js` runs in
the Custom Rules job (**Ran 34 of 34** locally).

Three things about how it is built are deliberate:

- **It compares TTL expressions, not resolved values.** `TTL_MEDIUM` and `DAY_LOG_TTL` are the same
  number today; the whole point of the named constant is what happens when one of them changes.
- **It covers `cachedFetch`, `cachedFetchToday`, `setCached` *and* the warm list.** A key warmed at
  one TTL and fetched at another has the same problem, and the warm list is the site most easily
  forgotten.
- **It prints its own blind spot.** Four call sites build the key from a helper (`cacheKey(view)`,
  `task.key`) and cannot be resolved statically. The count is printed on every clean run so a pass
  is never read as full coverage.

**It was wrong twice before it was right, and both are the reason it can be trusted now.** A first
version resolved a re-declared `const cacheKey` from the file's *first* definition, inventing a
divergence in `ai-periodization-session:` that did not exist — the wrong-occurrence failure the
handoff warns about, caught by reading the call sites rather than believing the tool. A second
version counted a comment sitting beside the argument as part of the TTL expression, so a comment I
had just added to `workout-screen.tsx` re-failed the check on a line I had just fixed.

**Mutation-verified.** Each fix was reverted in turn and the check failed naming that exact key —
`day-log:` (`DAY_LOG_TTL` at two sites vs `TTL_MEDIUM` at `health-content.tsx:526`) and `hr-profile`
(seven sites vs `observed-hr-card.tsx:23`). `workout-data:` is the one that failed *before* its fix,
which is the same evidence in the other order.

## A second, different bug in the same file

`observed-hr-card.tsx` held the **only** `useState(() => readCacheSync(...))` in the repo — the lazy
initializer CLAUDE.md forbids, since the server has no cache to read and the client does, so the two
first paints disagree (the session-165 hydration class, and Q-73's minified React #418). Moved into
the effect. This is the one user-visible change here and it is what the version bump is for; the TTL
convergence is invisible.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` · **`pnpm check:rules` — Ran 34 of
34** · full suite **469 files / 3,883 tests green**.

`pnpm dev` at 412×915, signed in as `test@local.dev`: `/health/day?date=2026-08-13` renders the day
with `GET /api/day-log` **200**, and `/health/heart-rate` renders the Heart-Rate Profile card with
`GET /api/hr-profile` **200** — including on a repeat visit, which is the cache-seeded path the
initializer fix changed. Zero console errors on both.

**A gotcha worth the next session's time:** running `pnpm build` and then `pnpm dev` against the
same `.next` leaves the dev server throwing `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'`
on every route — 500s that look like the change broke the app. `rm -rf .next` and restart. Also,
`pkill -f next-server` kills the shell that runs it; check `pgrep` output before trusting the kill.

**Not exercised:** the S25 APK. No layout or safe-area change here; the hydration fix is precisely
the class `pnpm dev` cannot prove either way, since dev and headless Chromium share one timezone and
one process.

## Left for the lane that owns it

Nothing. `components/workout-screen.tsx` is nominally Lane A's area but the one-line alias deletion
is inside Q-242's stated scope and would otherwise have forced a day-one exemption into a
brand-new guard, which is worse than a one-line cross-lane touch. Flagged here so it is not a
surprise in a rebase. No named `WORKOUT_DATA_TTL` constant was added — that would mean editing
`packages/shared/src/cache-ttl.ts`, which Lane A holds, and the check does not need it.
