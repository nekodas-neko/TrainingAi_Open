# Review — three lenses: leaked error text, AI rate-limit coverage, and cards that vanish

**Date:** 2026-08-18 · **Agent:** Review 📖 · **Sweep 33** · **Finding:** Q-499

Three lenses this sweep. **Two came up clean**, and they are written up first because a lens that
confirms is still a lens — a successor should not spend the time again.

## Clean 1 — internal error text in responses

Seven route files return `err.message` / `String(err)` in a response body. Every one is gated:

| Route | Gate |
|---|---|
| `admin/day-review`, `admin/db-query`, `admin/vacuum`, `admin/backfill-derived-scores`, `admin/battery-recovery-calibration`, `admin/sleep-feel-calibration`, `oura-ble/samples/pack`, `oura-ble/samples/redecode` | admin |
| `oura-ble/samples` | session |

Two apparent hits are not responses at all: `oura-ble/samples:171` is a `console.error` +
`reportServerError` on a background rollup that returns `null`, and `log-calendar-event:64` is a log
line **already truncated to 200 chars**.

And `admin/db-query` returning the raw SQL error is **correct by design** — it is a SQL console for
admins; hiding the error would defeat it. **No finding.**

## Clean 2 — rate-limit coverage on AI routes

`CLAUDE.md`: *"Every new AI or expensive route gets the standard rate limit at creation."*

A path/import grep produced 25 candidates, of which **7 had no `rateLimit` call** — six
`ai-periodization/*` routes and `training-load`. Checked individually: **all seven make zero LLM
calls** (no `generateObject`, `generateText`, `streamText`, or `@ai-sdk` import). They matched on the
`ai` path segment alone.

**Every route that actually calls an LLM has a rate limit.** The rule is fully satisfied. This is the
sixth consecutive sweep where the mechanical version of a check over-reported — the pattern is now
reliable enough to expect: *the grep finds candidates; the handler decides.*

## Q-499 — cards that cannot tell "no data" from "the fetch failed"

`CLAUDE.md` states the rule: *"Self-fetching cards need an explicit failure state — `cachedFetch`
swallows `!res.ok` including your own rate limit; a bare `return null` makes the card vanish silently
instead of showing an error state."*

**One correction to the rule's premise first:** `cachedFetch` does **not** unconditionally swallow.
`cachedFetchCore` accepts an `onError?: (info: CacheFetchErrorInfo) => void` callback. It swallows
*unless the caller opts in* — which makes this a coverage problem with an existing mechanism, not a
missing capability. The rule should say so, because as written it reads as though there were nothing
to call.

**Adoption:** 78 components call `cachedFetch`; **18 reference `onError`** — and that 18 is an upper
bound, since some are unrelated matches (`components/ai/code-block.tsx`, `components/ai/response.tsx`).

**Verified by hand, two instances:**

`components/health/hr-recovery-profile-card.tsx`
```ts
:48  cachedFetch<HrRecoveryProfileResponse>( … )        // no onError
:57  if (!profile || profile.bands.length === 0) return null
```
`profile` stays `null` when the fetch fails, so a failed request and a genuinely empty profile render
identically: the card disappears.

`components/health/strength-progress-card.tsx`
```ts
:36  ).catch(() => {})                                   // the smell CLAUDE.md names
:40  if (withData.length === 0) return null
```
Same conflation, with the failure explicitly discarded.

**Scoped honestly.** A crude filter (uses `cachedFetch`, contains `return null`, contains no
error/retry wording) produced **12** candidates. **Two were verified by hand and both conflate.** The
other ten are *candidates*, not confirmed defects — several `return null` paths in that list are
legitimate empty states, and distinguishing them needs the same per-file judgement that Clean 2 above
shows a grep cannot make. The implementer should treat the list as a worklist, not a defect count.

**Why it matters more than it looks.** The failure this hides is not only a network drop: `cachedFetch`
treats **any** `!res.ok` the same way, including a **429 from the app's own rate limiter**. So a user
who trips a limit sees health cards silently disappear rather than "try again in a minute" — and the
same silence covers a 500. Offline it is worse: `cachedFetch` cannot revalidate at all.

**Fix shape:** pass `onError` and render a compact error state, following the components that already
do — `components/health/observed-hr-card.tsx` and `components/workout/workout-load-error.tsx` are the
in-repo references. Amend `CLAUDE.md`'s wording to name `onError` so the next reader knows the hook
exists.

**Severity: low-medium.** Cosmetic in the common case; the sharp edge is that a rate-limited or erroring
card is indistinguishable from an empty one, which makes user reports of "the card is gone"
undiagnosable.

## Not exercised

Static reading plus two hand-verified components. **The vanish was not reproduced in a browser** — no
card was driven to a 429 or a 500 to watch it disappear, which is the obvious next step and would
promote the ten unverified candidates from a worklist to a count. No device, no production.
