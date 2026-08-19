# 2026-08-19 — Q-396 (Lane A half): a photo per saved meal, and the cap that makes it survivable

**Branch:** `feat/saved-meal-thumbnail` · Implementation Lane A · JS/server + a Postgres migration
and a local SQLite version. **No APK needed** — but the local schema moves, so an existing device
upgrades on next open.

## Premise re-verified before building

All three claims in the entry held: `users.avatar` really does allow **5 MB** of data URI,
`saved_meals` really had **no** image column, and `saved_meals` really **is** an outbox domain. The
last one is the whole argument — see below.

## The cap is the design, and the precedent does not transfer

`users.avatar` stores a full data URI at up to 5 MB and that costs nothing, because **an avatar is
one row per user and never enters the sync delta**. A meal thumbnail is one per saved meal and saved
meals sync, so every image rides the outbox push, the pull, and the on-device SQLite mirror, on a
phone, forever. Copying 5 MB here would be the largest single regression the sync engine has taken.

So: **16 KB decoded, in a named constant next to the reasoning**
(`SAVED_MEAL_IMAGE_MAX_BYTES`, `packages/shared/src/nutrition/meal-image.ts`), MIME-whitelisted, and
validated **server-side on every path** — a client-side cap is not a cap.

**Base64 in a text column rather than object storage**, deliberately: the app is offline-first with
no blob host, and a URL renders nothing in airplane mode, which breaks the standing rule that a local
table must hold everything needed to render its row offline.

## Four things the chain-check caught that a narrower change would have shipped broken

**1. The body cap would have rejected a legitimate image.** Both saved-meal routes were capped at
32 KB. A 16 KB *decoded* image is **~21.3 KB of base64 characters**, and a 100-item meal is ~6 KB on
top — so a max-size photo would have 413'd with something that looked like a bug in the upload.
Raised to 64 KB, with the arithmetic in the comment.

**2. A name edit would have deleted the photo.** Local upserts overwrite every column by default —
the standing rule — so an offline edit that says nothing about the image would have cleared it. The
local upsert now distinguishes *omitted* (`COALESCE`, keep what is stored) from an explicit `null`
(remove), matching the server, where the same distinction is carried into the `onConflictDoUpdate`
set.

**3. The offline replay needed its own validation.** `pushMutations` does not go through either
route, so the cap is re-checked there. An oversized payload **quarantines that one mutation** with a
message rather than wedging the queue behind it.

**4. `hydrateSavedMeals` uses `?? null`, not omission** — and that asymmetry is deliberate. The server
list is authoritative there, so a photo removed on another device must disappear locally too.

## The audit view: denied, with a size stand-in

The regenerated `claude_ro` views (**migration 205**) **withhold `image_data_uri`** and expose
`octet_length(...) AS image_bytes` instead — the same shape as `feedback_submissions.screenshot_data`,
which was the precedent. That is not just noise-reduction: this feature's stated risk is the cap
slipping unnoticed, nothing fails loudly when it does, and a queryable byte count is the cheapest
possible tripwire. Every row carrying kilobytes of base64 into an audit read would have been worse
than useless.

## Verification

`npx tsc --noEmit` clean · `pnpm lint` clean · `pnpm check:rules` **Ran 49 of 49** (including
`check-reconcile`, `check-local-column-upgrade-path` and the backlog pointers, all of which had
something to say) · full suite **520 files / 4,259 tests passed** · migration 205 applied to the local
database and the view re-read to confirm the column list is `id, user_id, name, created_at, servings,
image_bytes`.

**The local-schema guard did its job and had a stale label.** `migrations.test.ts` asserted the max
version and failed on the bump — correctly — but its `describe` and title both said *"v25"* while the
assertion said 27. Renamed to what it checks rather than to a number that goes stale on the next bump.

## Not exercised

**The device.** The local SQLite path needs the APK: `getLocalStore` returns null in the web sandbox,
so the v28 upgrade, the `COALESCE` preserve-on-omit and the hydrate overwrite are all covered by unit
tests and by reading, not by running. The check is: edit a saved meal's name offline and confirm the
photo survives, then remove the photo on another surface and confirm it disappears after a sync.

**There is nothing to look at yet.** The picker is Lane B (**Q-327**), and until it lands no image can
be set from the app at all — the column is reachable only through the API. That is the split the entry
asked for, and the UI degrades to no image, so the halves are independent.

**The downscale is Lane B's and is load-bearing.** The server rejects over 16 KB, so without a
client-side canvas downscale a normal phone photo is a 400 every time and the feature reads as broken.
