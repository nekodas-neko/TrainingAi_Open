# BF-77 — sharing a food library: browse a friend's meals, copy what you want

**Status:** plan (docs-only PR 1). Implementation entries: `BF-77` (engine, Lane A) · `BF-77a` (surface, Lane B).
**Owner's question (2026-09-20):** *"the most efficient way to share a food library"*.
**Owner's answer on 2026-09-13:** yes to a share "library", **alongside** copy-a-meal, not instead of it.

## 1. What sharing already works — and it is more than the backlog entry said

- **One meal, as a copy, offline, with no account link.** `encodeSharedMeal`
  (`packages/shared/src/nutrition/label-payload.ts`) puts the whole recipe in the label's QR: the name,
  servings, and each ingredient's grams, kcal and P/C/F. Scanning it runs
  `saveSharedMealToLibrary` (`components/nutrition/save-shared-meal.ts`). That function copies the
  ingredients into the scanner's own `food_items` (per-100 g, deduplicated) and saves a new meal. The
  label sheet's system share button sends the PNG, so the recipient can scan it off a screen.
- **⚠ The backlog's proof that this is unbuilt is stale.** It cited `meal-label-render.ts:694` still
  calling `encodeMealLabelToken`. Today `renderMealLabel` (~line 489) encodes the recipe for every style
  where `mealLabelCarriesRecipe(style)` is true. The owner-only token is kept only for the tiny jar
  styles, and that is a deliberate choice. BF-57's surface shipped, and the two-phone test passed on
  2026-09-13.

## 2. What is inadequate about it — the reason to build anything

1. **One meal per scan.** The owner has eight or more meals and keeps making them. Sharing a library
   means printing or screenshotting and scanning each meal, and doing it again for every new one.
   That is the actual ask: *"have the same meals"*.
2. **The payload is capped.** The code gives way at 251 bytes, so a long recipe rolls its tail into
   "+N more". The totals stay exact, but the copy loses the tail ingredients as separate items.
3. **It needs an image to change hands.** The partner has to receive a picture and point a camera at
   it. That is fine for one meal and absurd for a library.
4. **Friends see no nutrition at all.** `friendships` exists (requester/addressee/status), and friends
   already see PRs, workouts and profiles through `app/api/friends/**`. No meal data is exposed.

None of these is about *how a copy is made*. The copy path is right. What is missing is a way to
**see someone's whole library** and take from it without an image in between.

## 3. Recommendation — a friend's meal library, read-only, with one-tap and copy-all

A friend who has **opted in** exposes their saved meals to accepted friends. You open their library,
see every meal with its full recipe and macros, and tap **Add to my meals** on one of them, or on the
whole library. Every add is a copy made through the same `saveSharedMealToLibrary` a scan uses.

**Why this is the most efficient mechanism, not just the smallest:**

- **It reuses every hard part.** The relationship and its consent handshake are `friendships`, which
  is already accepted both ways. The copy is `saveSharedMealToLibrary`, fed a `SharedMeal` that the
  server builds with `savedMealToIngredients`, the one meal-to-data conversion (see the backlog's
  *totals are sacred* rule). The opt-in lives in `users.preferences` (jsonb, Q-392), so **there is no
  migration**. The only new server code is one read route.
- **It removes the 251-byte cap for this path.** The route returns JSON, not a QR, so a
  20-ingredient meal arrives whole. The label path keeps its cap, which is a property of paper.
- **It keeps the principle the owner chose twice** (BF-57 rejected globally-resolvable meal ids;
  BF-58 rejected a household link). The data never couples: your copy is yours, and the author's edit
  never rewrites your history or your logged days.
- **It adds no sync domain.** Browsing a friend's library is an online read. It is not a local-first
  domain, because it is not yours. What you copy lands in your own local store and outbox through the
  existing path, so it is offline-first from that point on. `saved_meals` stays out of the delta,
  exactly as today.
- **The consent surface is one toggle per person, default OFF.** The owner decides whether *his*
  library is visible. Nobody's food is visible to anyone by default. That is the Play-Store-grade
  answer the backlog said a group library would need, at the cost of a single preference.

**What "the same meals" means under this design:** you copy the whole library once, and later copy
whatever is new. A later edit by your partner does not reach your copy.

## 4. Alternatives, and why each lost

| | Better at | Why it lost |
|---|---|---|
| **Short share code / link** (server snapshot) | Sharing with someone who is not a friend in the app | It solves remote sharing of *one* meal, which is §2's smallest gap, and still costs a snapshot store, a code space, expiry and a rate limit. The friend library covers the partner case without any of that. |
| **Group library** (co-owned meals, edits propagate) | A genuinely living, shared recipe book | It needs membership, invites, per-meal edit rights and a rule for what an edit does to a meal already logged. It also couples two users' data, which the owner declined twice. Copies that diverge are copies; a shared library that diverges is a bug. |
| **Bulk export file** (JSON of the library) | Moving a library between two accounts once | It needs a file to change hands and is re-done for every new meal, the same failure as §2.1 at a larger size. |

## 5. Deliberately left for later — "tell me when their meal changed"

If copies turn out to drift in a way the owner minds, the upgrade is to **notice** changes, not to
propagate them. Stamp each copy with `source_user_id` and `source_meal_id`, compare against the
author's `updated_at` in the friend view, and badge it *"updated since you copied"* with a re-copy
button. That delivers the useful half of a living library with no shared writes. It needs two columns
(a migration plus a `claude_ro` twin), so it is **not** in BF-77. File it only when the owner asks
for it.

## 6. Implementation

### BF-77 — engine (Lane A)

1. **Preference.** Add `shareMealLibrary: boolean` to `UserPreferences`
   (`packages/shared/src/user/preferences.ts`), default `false`. It is server-authoritative, not
   device-local: it is a statement to other people, so it must be the same on every device.
2. **Route: `GET /api/friends/[id]/saved-meals`.**
   - Return 404, never 403, unless there is an **accepted** friendship in either direction **and** the
     friend's `shareMealLibrary` is true. The response must not tell a stranger that a user exists,
     or reveal a friend's setting.
   - Read the friend's non-deleted saved meals and build each `SharedMeal` from
     `savedMealToIngredients`.
   - Send the payload uncapped, as JSON with no roll-up, plus `mealId` and `updatedAt` so the
     surface can show "you already have this".
   - Use the friends routes' rate limit and `Cache-Control: private, no-store`.
   - Only name, servings, ingredients and macros leave the server: no log history, no times, and no
     item ids. Ingredient ids would be meaningless to the recipient, and `writeSavedMeal` rightly
     rejects foreign food items.
3. **Tests.**
   - 404 for a non-friend, for a pending friendship, and for an opted-out friend, each with an
     identical body.
   - The totals from the route equal the author's meal totals, which is the *totals are sacred*
     rule.
   - A deleted meal is absent.
   - Row-level ownership: requesting your own id through the friend route is not a way round the
     friendship check.

### BF-77a — surface (Lane B, `Needs: BF-77`)

1. **Opt-in toggle** on the nutrition settings screen: *"Let friends see and copy my saved meals"*,
   off by default, and one line on what it shares.
2. **Entry point**: a **Meals** row on the friend's profile (`app/friends/**`), shown only when the
   route answers 200.
3. **Friend library screen**: the meal list with per-meal macros and an expandable ingredient list.
   Each meal gets **Add to my meals**, and the header gets **Add all**. Adding calls
   `saveSharedMealToLibrary` unchanged. Meals already in your library by name are marked, so
   **Add all** skips them rather than duplicating them. It is a name match and the copy is a copy,
   so the mark is a hint, not a link.
4. This is a new screen and a new row, and it does **not** rearrange anything the owner uses daily,
   so no mockup gate applies.

### Verification

- **Engine:** the tests above, plus `pnpm dev` with two local users. Befriend them, toggle the
  preference, and read the route with each state.
- **Surface, on device** (`Lane: DV` once shipped):
  1. The owner opts in.
  2. The partner's account (or a second test account) opens his library and uses **Add all**.
  3. Every meal lands in the partner's library with identical total macros, including a meal of more
     than 12 ingredients, which the label path would have rolled up.
  4. The partner logs one of the copies in airplane mode, and the log stands.
