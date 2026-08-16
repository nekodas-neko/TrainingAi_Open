# 2026-08-15 — the second Home screen is gone (Q-236)

**Branch:** `claude/ia-cluster-app-shell` · **No version bump** — nothing a user could reach changed.

`/overview` rendered `components/overview-screen.tsx`, 543 lines with its own fetches and cache
reads, and **nothing in the app linked to it**. Verified before deleting, as the entry insisted:
every `href`, `router.push` and `redirect` across `app/`, `components/`, `lib/` and `packages/`
turned up one referrer, `app/sheet/[id]/overview/page.tsx`, which has no referrers itself. The push
sender (`lib/push.ts`) carries no URL at all, so no notification payload points there, and the
manifest's `start_url` is `/session-select`.

## The review predicted the drift; it had already happened

The case for deleting rather than wiring it up is not that it was unreachable — it is that a second
implementation *had already diverged from the first*:

| | `overview-screen.tsx` | `lib/home/home-prefs.ts` (canonical, used by Home) |
|---|---|---|
| storage key | `ta_meta_widgets` | `ta_ss_widgets` |
| defaults | `weightKg, steps, calories, protein, carb, fat` | `weightKg, steps, calories` |
| SSR guard | none | `typeof window !== "undefined"` |

Private copies of `loadWidgets`/`saveWidgets` against a *different* key with *different* defaults —
so the orphan and Home could never have agreed even if someone had linked to it. That is the
One-Formula-One-Place rule, broken inside a screen no one could open.

## Deleted

- `app/overview/page.tsx`, `components/overview-screen.tsx`.
- **`components/readiness-card.tsx` (269 lines)** — its only importer was `overview-screen`, so
  deleting the screen would have left it dead with a passing grep. Exactly the Q-238 / Q-180 shape,
  and the reason to take it in the same PR rather than file it.
- The `'overview'` background palette, which the entry did not mention: the `pathnameToSection`
  branch and the `pathnameToPaletteKey` branch in `dynamic-background.tsx`, the `ScreenPaletteKey`
  union member in `lib/background/screen-palettes.ts`, and **both** `--screen-palette-overview`
  definitions in `globals.css` (light and dark).

Two stale comments went with it: `app/api/readiness-score/route.ts` named `readiness-card.tsx` in a
list of importers that claimed "five call sites" while naming four — there are ten, so the list is
replaced with the count and a note not to enumerate it again; and `done-screen.tsx` referenced it as
a pattern source.

## What was NOT deleted, and why

The entry says to delete the three `app/sheet/[id]/*` shims. **They stay.** `projectOverview.md`
records an owner decision of 2026-08-10 (Q-136): *"Kept: the `/sheet/[id]/*` shims, which look like
dead redirects and are the reverse — the only inbound path to `/chat`."*

That rationale expired on 2026-08-13, when `#1293` deleted `app/chat/`, `app/sheet/[id]/chat/` and
`/api/ai-chat/tts` on a *different* owner decision. Neither decision was wrong; they were simply not
made against each other. Reversing a recorded owner decision on my own reading is the thing the
decision exists to prevent, so it is filed as **Q-255** for the owner instead.

`app/sheet/[id]/overview/page.tsx` still had to change — it redirected to a route this PR removes,
and a redirect to a 404 is strictly worse than either option. It now points at `/`.

**Getting that target right needed the dev server, not reading.** The first attempt pointed it at
`/session-select`, which looks like Home and is named like Home — the manifest's `start_url` is
literally that. It is a legacy redirect to `/workout`, so the shim landed on the **Workout tab**.
The real Home is `/` (`app/(home)/page.tsx`). Caught by following the redirect in a browser and
reading the final URL.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` (exit 0; `/overview` absent from
the route table, `/sheet/[id]/overview` still present) · **`pnpm check:rules` — Ran 34 of 34** · full
suite **470 files / 3,893 tests green**.

`pnpm dev` at 412×915 as `test@local.dev`:

- `/overview` → **404**.
- `/sheet/abc/overview` → **`/`**, rendering Home with its readiness, HR, sleep and activity cards.
- Every screen whose palette-key list I touched still renders: Home, `/stats` (→ `/health?tab=training`),
  `/health?tab=body`, `/nutrition`, `/more`, `/workout-select`, `/session-explain`. Zero console
  errors across all of them.

**A gotcha worth knowing:** `tsc` failed after the deletion on
`.next/types/validator.ts(260,39): Cannot find module '../../app/overview/page.js'` — a stale
generated type from the previous build, not a real error. `rm -rf .next` clears it.

**Not exercised:** the S25 APK. The palette removal is CSS-variable-only and no layout, safe-area or
sheet geometry changed, but the Samsung WebView has not seen it.
