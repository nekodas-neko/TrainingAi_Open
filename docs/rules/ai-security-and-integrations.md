# AI, security and external integrations

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## Live AI calls in testing: one key, one balance

Every Gemini key we hold — production on Railway and every agent's machine — draws on **one prepaid
Google balance**, and when it reaches $0 Google stops every key at once. On 2026-10-11 agents testing
the Coach on `pnpm dev` against real Gemini ([#2793](https://github.com/nekodas-neko/TrainingAi_Open/pull/2793),
[#2796](https://github.com/nekodas-neko/TrainingAi_Open/pull/2796)) made **about 460
`gemini-3.6-flash` requests and about 3.8M input tokens**. That emptied the balance, and every AI
feature in the live app failed ([#2815](https://github.com/nekodas-neko/TrainingAi_Open/issues/2815),
[#2814](https://github.com/nekodas-neko/TrainingAi_Open/issues/2814)). The owner chose to keep the one
key and make testing safer instead ([#2816](https://github.com/nekodas-neko/TrainingAi_Open/issues/2816)).

- **Logic is tested with mocks.** A route's handling of a model reply — parsing, tool wiring, error
  paths, what reaches the DB — never needs the real model. Mock `ai` or `@/lib/ai/instrument` as the
  existing route tests do.
- **Real Gemini only to measure model behaviour** — whether a prompt change moves what the model
  does — and then with the fewest runs that answer the question. Decide the number before starting.
- **Every PR that made live calls says roughly how many** under "How it was tested", and "none" when
  it made none.
- **The dev cap enforces it.** `lib/ai/dev-call-budget.ts` refuses a live request once a machine has
  made **100 in a rolling 24 hours** (`DevAiBudgetError`, before anything is sent). It counts model
  *requests*: a retry is one, and **one Coach turn is up to 6** (`COACH_MAX_STEPS`), so the default is
  roughly 16 Coach turns a day. It is on for `pnpm dev`, plain node scripts and `RUN_LIVE_AI_TESTS=1`
  runs; off in production (`NODE_ENV=production`, or any Railway environment variable) and in the
  ordinary test suite. It covers every call through `lib/ai/instrument.ts` and the direct
  `@google/genai` calls in `lib/exercise-image-gen.ts`.
- **Raising `AI_DEV_DAILY_CALL_LIMIT` needs the owner's say-so**, asked as a `type: question` issue
  stating how many requests and why. It is the owner's money and every user's AI.
- **`AI_DEV_DAILY_CALL_LIMIT=0` gives a mocks-only session**: any code path that would call Gemini
  fails fast with `DevAiBudgetError` instead.

---

## One set of rules for every AI call (#3752)

- **Settings live in one table.** `AI_SECTIONS` in `lib/ai/instrument.ts`, keyed by section name:
  model, thinking level, SDK retries, time limit. A route names its `section:` and passes none of
  them: the wrapper (`loggedGenerateObject`, `loggedGenerateText`, `loggedStreamText`) hands the call
  its settings, and a route spreads them into the SDK options. A new AI call adds a row, not a
  `maxRetries: 0`. There is **no temperature**: Google's guidance for these models is to leave it at
  the default and newer ones ignore it, so a repeatable answer has to come from code deciding more.
- **The model's confidence is not asked for.** The workout plan prompt used to ask for one and the
  code threw it away in favour of `computeConfidence`. It is gone from the prompt and
  `PrescriptionSchema`; an older answer that still carries the key parses and the key is dropped.
- **A custom rule holds the line.** `node scripts/check-ai-call-sites.js` (a Custom Rules step, so
  `pnpm check:rules`): `generateObject`, `generateText` and `streamText` are called only inside a
  logged wrapper whose `section:` is a literal key of the table, and `@google/genai` is imported only
  by `lib/exercise-image-gen.ts`.
- **The image tool logs.** `lib/exercise-image-gen.ts` spends from the same key and writes one
  `ai_call_log` row per model request under section `exercise-image` (success, a reply with no image,
  or a throw). It has no signed-in user in hand, so `user_id` is empty there.

### What the person sees when the model is down

Checked against the code on 2026-11-21. "Paused" means Google refused on billing
(`aiPausedResponse`, a 503 `ai_paused` with a fixed message); any other failure is the route's own
error.

| Feature | When the model is down today | What it should offer instead (not built) |
|---|---|---|
| Workout plan (`prescription`) | The program as written, from rules, with its own reasoning line (a deload week as the program runs it, or the program's own sets). Never an error. | Nothing to add. |
| Workout recap | No model is involved: the route answers from the session's numbers (#3748), the same text every time. | Nothing to add. |
| Coach (`coach`) | When the refusal is billing: the fixed "paused" sentence. Any other failure: a generic error line (`An error occurred.` in the stream, or a 500 `Coach failed`). | Say plainly it could not be reached, and link the screens that answer without it (today's plan, the log). |
| Food scan (`nutrition-scan`) | An error: 502 "AI service unavailable. Please try again." (or paused). | Offer food **search** and **barcode** on the same screen, with the photo kept so it can be retried. |
| Meal plan (`meal-plan-generate`) | An error (502, or paused), **except** slots the library fills and a plan that needs nothing from the model, which come back without one. Rerolling or rewriting one meal (`meal-plan-generate-meal`, `meal-plan-edit-meal`) is an error. | Fill every slot from the saved-meal library and offer the last plan again; say which slots could not be filled. |
| Meal top-up (`meal-plan-top-up`) | The meal as scaled, with its gap shown. Never an error. | Nothing to add. |
| Program builder (`generate-program`) and builder chat (`builder-chat`) | An error (502/500, or paused). | Offer to start from a saved program or a blank one in the program editor, and keep what the person typed. |
| New exercise (`exercises-generate`) | A name the library already holds is answered from the library with no model call (#3751). Any other name is an error (500, or paused). | Offer the manual add form (name, muscles, equipment) and the library search. |

The issue listed the recap as "the facts joined into a line" and the coach as "a paused message";
both were corrected above: the recap no longer calls a model, and the coach shows the paused message
only for a billing refusal.

---

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
