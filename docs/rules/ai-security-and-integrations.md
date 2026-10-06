# AI, security and external integrations

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## AI & Security Defaults

- Every LLM call returning structured data uses `generateObject`/a response schema — never `JSON.parse` of free text. Keep it that way: prose-only `generateText` routes must never grow a `JSON.parse` of model text, and every `generateText`/`streamText` call is wrapped in try-catch returning a JSON error (`health-insight` and `weekly-digest` once shipped without). Deterministic math lives in code: no LLM self-reported number (confidence, totals) may gate an automatic action **or be shown to the user as fact** — a model handed a score of 80 called it *"perfect"* twice (Q-292), which gates nothing and is read as true. Prose routes import `PROSE_GUARDS` (`lib/ai/prompt-guards.ts`): quote the given numbers, no superlatives, metric units only, and no diagnosis — describe a deviation, never name a condition or suggest infection (#2421, TN-46).
- Security checks fail **closed**: a missing signature header, missing signing key, or oversized/mistyped input is a rejection, not a skip (the Oura webhook once skipped verification when the header was absent).
- **Write-path ownership discipline (this bug class recurred across 3 domains — 2026-07-06 review):**
  (a) after a user-scoped UPDATE whose row id came from the client, **check the affected-row count** before any dependent child write — a 0-row match followed by an unscoped `DELETE … WHERE parent_id = id` + re-insert is a cross-user wipe (the `saveProgressionStyle`/`updateSavedMeal` class);
  (b) **never pass a raw request body into Drizzle `.set()`** — `userId`/`deletedAt`/`createdAt` are settable column keys and the TypeScript `Omit<>` is compile-time only; Zod-whitelist every PATCH/PUT body at creation (`updateInjury` is the reference);
  (c) **client-supplied row ids in upserts must be ownership-verified even when the table has no `user_id` column** — pre-check via a join to the owning table (exercise/set logs → `workout_sessions`), exactly as `ensureWorkoutSession` does for session ids.
- **Webhooks verify signatures before any DB lookup keyed on unverified payload fields.** The lookup itself (e.g. a per-user signing key) can't always be avoided, but the *response* must not diverge before verification completes — branching to a different status code for "user not found" vs "bad signature" is an enumeration oracle. Look the user up, but let verification (which already fails closed on an undefined key) produce the response.
- **Ingest routes get a Zod schema at creation**, same as sibling routes — untyped numeric passthrough to the driver is not validation.
- **Self-fetching cards need an explicit failure state** — `cachedFetch`/`useCachedValue` swallow `!res.ok`, including your own rate limit, *unless the caller passes `onError`*; a bare `return null` with no `onError` makes the card vanish silently instead of showing an error state (Q-499).
- **Cumulative per-day fields from an external API must treat "today" as a partial day** — don't assume a full 86,400s (the Oura `wornHours` mistake); a partial-day cumulative reads as an anomaly if compared against completed-day values.
- Every new AI or expensive route gets the standard rate limit at creation — check its sibling routes and match them.
- No silent fallbacks on failure paths: log and surface an error state; wrap AI/external calls in try-catch returning JSON errors. When adding a DB column, update **every** row→object mapper (`rowToX`, SELECT lists) — a missed field fails silently as "save doesn't persist" (sessions 29, 64).

---

## External API & Plugin Field Names — verify against the pinned source

Field names written from memory have shipped dead integrations repeatedly: Oura's v2 field is `latency` (not `onset_latency` — NULL in the DB since the integration shipped), Health Connect record keys were wrong **twice in a row** (the pinned alpha uses legacy keys — only the version's sources jar settled it), HRV used `Sdnn` instead of `Rmssd`.

- Before using any external field/key/scope string, read the pinned version's actual source or spec (the bundled Oura OpenAPI, the plugin source in `node_modules`) — not the latest docs, not memory.
- Then prove end-to-end that a **non-null value lands in the DB column** before calling the integration done — a wrong field name reads as `undefined` and fails silently.
- One bad key can reject an entire batch call (Health Connect `requestPermissions`).
- Zod `.optional()` rejects `null` — clients must omit empty fields, never send null (this broke every food save in v1.42.4).

---

## One Formula, One Place

Domain math — 1RM, ACWR, weekly cadence, expected RPE, score bands, muscle-name normalisation — lives exactly once and is imported everywhere. **Most of it is in `packages/shared/src/`, not `lib/`** — the monorepo extraction moved it and this rule kept saying `lib/` for months (Q-153). Check [`docs/module-map.md`](../module-map.md) for where a given formula actually is rather than guessing a directory. The weekly-cadence formula once existed in **four** copies with two different semantics; 1RM had divergent client/server/edit-path copies (wrong high-rep guard → inflated PRs). `computeVolumeAcwr` is the only ACWR implementation (the old inline flat-÷4 copy in `app/api/training-load` was retired — verified gone 2026-07-06); clients render the route's `interpretation`, never re-band raw numbers themselves. Score-band labels come from `scoreBand()` — never re-derive the 70/50 thresholds with local label strings (two divergent copies found 2026-07-06: `packages/shared/src/session-explain/group-signals.ts`, `app/api/ai/health-insight`). Time windows for stats/AI tools anchor at `todayMidnightUtc(tz)`, never `Date.now() − N×86400000` — six copies of the banned ms-offset pattern shipped in `lib/ai-chat/tools.ts` (2026-07-06 review) after the same class was fixed in session 62. Before writing any formula, grep for an existing implementation. When fixing a formula, grep for its duplicates and fix or delete them in the same PR. Two implementations of the same metric is a bug by definition. **[`docs/module-map.md`](../module-map.md) indexes where each formula and shared module already lives — check it before writing a new one.**

---

## No Hardcoded Session Names or Training Structure

**This is a strict rule.** The app must work for any user with any program structure — not just Push/Pull/Legs.

- **Never hardcode session names** like `"Push"`, `"Pull"`, `"Legs"` anywhere in the codebase. All session references must come from the user's active program fetched from the DB.
- **Never hardcode training cycles, rest day logic, or rotation patterns.** Rest days, training frequency, and cycle length are all user-configured via the schedule in their program.
- **Fallback arrays** (e.g. `FALLBACK_SESSIONS`) are only acceptable as a loading placeholder while the real program loads — they must be empty shells with no named content, or omitted entirely.
- **Session identity = DB id**, not name. Any logic that keys off a session name (tab lookups, cache keys, colour assignments) must use the session's `id` or `position` instead.

---
