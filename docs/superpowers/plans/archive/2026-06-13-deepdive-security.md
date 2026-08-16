> ✅ **COMPLETED** — All tasks in this plan have been shipped to production.
> See `projectOverview.md` for session-by-session implementation details.

---

# Deep-Dive Audit #2 — Security & Repository (2026-06-13)

Scope: all ~80 routes under `app/api/**`, repository ownership patterns, migrations. Excludes
S2–S24 / B6–B23 (already fixed) and the session-104 security plan. **Next free migration number: `064`.**
No migration findings — all legacy raw DDL is wrapped in guarded `DO $$ … information_schema … $$` blocks.

Skill: `.agents/skills/db-migrations-repository/SKILL.md` (ownership/IDOR, repository pattern, idempotent migrations).

---

## Task 1 — Cross-tenant style reference in phase-set update (IDOR) · **Med**

- **Where:** `app/api/phase-sets/[id]/route.ts:20-32` → `lib/data/postgres/adapter.ts:811-842` (`updatePhaseSet`)
- **Problem:** Ownership of the *phase set* is checked, but the client-supplied `primaryStyleId`/`secondaryStyleId` are written into `program_phases` with no check that those style UUIDs belong to the caller. A user can pin another user's progression-style UUID into their own phase; if style content is resolved server-side for rendering/program generation, it leaks another tenant's style config.
- **Fix:** Before insert, load the caller's styles (`repo.listProgressionStyles(userId)`) and reject (or null out) any supplied `primaryStyleId`/`secondaryStyleId` not in that set.
- **Verify:** Add a test/manual check: PATCH a phase set with a style id owned by another seeded user → expect 403 (or the field nulled), not a write.

## Task 2 — Cross-tenant food-item / meal-type reference in food log (IDOR) · **Med**

- **Where:** `app/api/nutrition/food-logs/route.ts:23-32` → `lib/data/postgres/adapter.ts:2135-2140` (`createFoodLog`); same pattern in `saved-meals` POST/PUT which embed `foodItemId`s.
- **Problem:** `createFoodLog` inserts client `mealTypeId` + `foodItemId` tagged with the caller's `userId`, with no ownership check on those referenced rows. A crafted request can reference another user's meal type / food item; a subsequent joined read surfaces that tenant's food-item name/macros into the caller's diary.
- **Fix:** Validate both ids belong to `userId` before the write (add `getMealTypeOwner`/`getFoodItemOwner`, or scope a batched lookup). Apply the same guard to `saved-meals` POST/PUT.
- **Verify:** Seed two users; POST a food log referencing user-B's foodItemId as user-A → expect rejection.

## Task 3 — Unbounded array/body writes (DoS) · **Med**

Each route casts/destructures `await req.json()` straight into a DB write with no array-size or numeric bounds; one request can insert thousands of rows or absurd values.

- `app/api/personal-records/seed/route.ts:16` — `entries[]` uncapped
- `app/api/activity-logs/route.ts:~21-23` — `splits` / `paceSeries` / `bestEfforts` uncapped
- `app/api/progression-styles/route.ts:~23-28` — `style.sets[]` uncapped
- `app/api/nutrition/saved-meals/route.ts:20` & `saved-meals/[id]/route.ts:11` — `items[]` uncapped
- `app/api/body-metadata/route.ts:~98-108` — numeric fields (weightKg, calories, protein…) no `.min()/.max()`
- **Fix:** Wrap each in a Zod schema with `.max()` array caps (100–10000 by field) and numeric bounds, returning 400/413 on violation — mirror the existing `sync-workout` / `sync-health` (`MAX_ITEMS`) patterns.
- **Verify:** POST an oversized array to each → expect 4xx, no rows written.

## Task 4 — Validation gaps on profile / nutrition writes · **Med**

- **Where:** `nutrition/food-items/route.ts:20-35` (unbounded `name`/`brand`), `nutrition/meal-types/route.ts:34-42` (unbounded name; no 0–24 bound on hour fields), `nutrition/food-logs/route.ts` (no bound/positivity on `quantityMultiplier`), `nutrition/targets/route.ts:20-26`, `user/profile/route.ts:28-36`, `user/goals/route.ts:27-35`.
- **Problem:** Numeric goal/target/profile fields accept negatives/extremes; strings have no length cap. Low individual impact, consistent unbounded surface.
- **Fix:** Add Zod bounds (string `.max()`, numeric `.min().max()`, hour `0–23`).
- **Verify:** Submit a negative goal and a 100k-char string → expect 400.

## Task 5 — Rate-limit gaps on enumerable / write-spam routes · **Med**

- `app/api/nutrition/barcode/route.ts:37` — proxies Open Food Facts by client barcode, **no** `rateLimit()` → unthrottled enumeration/proxy.
- `app/api/nutrition/scan/route.ts` — has a size guard but **no** `rateLimit()` despite calling the paid Gemini vision model.
- `app/api/mood/route.ts:20` (POST) — no per-user write throttle.
- **Fix:** `rateLimit('barcode:<userId>', …)`, `rateLimit('nutrition-scan:<userId>', …)`, `rateLimit('mood:<userId>', …)`.
- **Verify:** Hammer each past the limit → expect 429.

## Task 6 — `nutrition/scan` image-size guard uses wrong byte basis · **Low**

- **Where:** `app/api/nutrition/scan/route.ts:43-46`
- **Problem:** Size guard computes `Buffer.byteLength(image, 'utf8')` on a base64 string instead of `'base64'`, under-restricting the real payload reaching Gemini by ~33%.
- **Fix:** Measure with `Buffer.byteLength(image, 'base64')` (or decode then check `.length`).

## Task 7 — Repository-pattern bypass (6 routes) · **Low**

Not exploitable (all parameterized) but violates "never bypass the repository":

- `app/api/workout-entry/route.ts:18,46,104` (raw `getPool()`; ownership-checked & parameterized — see also Logic plan Task 1)
- `app/api/exercise-gif/route.ts:33`, `friends/feed/route.ts:18`, `friends/leaderboard/route.ts:28`, `admin/exercises/route.ts:29,65,98,126`, `admin/seed-exercise-gifs/route.ts:14`, `profile/[userId]/route.ts:24`
- `app/api/program-week/route.ts:4,16` — instantiates `new PostgresWorkoutRepository(...)` instead of the `getRepository()` factory.
- **Fix:** Move each query into a `WorkoutRepository` method over time; switch `program-week` to `await getRepository()`. Lowest priority for admin/friends read paths.

## Task 8 — Hardening niceties · **Low**

- `log-calendar-event/route.ts:16-18` — guards on `session?.refreshToken` only; add an explicit `if (!session?.user?.id)` guard for clarity (not a bypass today — the refresh token self-scopes to the caller's calendar).
- `friends/route.ts:25-28` — distinct 201 vs 400 for found/not-found enables slow email enumeration despite the limiter; return a uniform "request sent if the account exists" response.

---

## Verification & commit

- `pnpm exec tsc --noEmit && pnpm lint && pnpm test`
- For each IDOR/bounds task add a focused test against the local dev Postgres (`pnpm db:local`) with two seeded users.
- Security fixes that change route behaviour are user-invisible → commit straight to a feature branch; if shipping, bump `package.json` **patch** and add a `lib/changelog.ts` line only if a user-facing symptom changes (most are silent hardening).
