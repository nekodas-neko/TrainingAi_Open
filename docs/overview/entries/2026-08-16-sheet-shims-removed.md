# 2026-08-16 — two owner decisions, one deletion

Both of the app-shell lane's remaining items were questions rather than work. The owner answered
both, so this closes them: the `/sheet/[id]/*` shims are gone, and the More tab's content stays where
it is.

## Q-255 — the shims are deleted

`app/sheet/[id]/{config,overview,workout}/page.tsx` were three one-line `redirect()` files. They had
zero in-app referrers, and the reason they were kept — an owner decision of 2026-08-10 (Q-136) that
they were *"the only inbound path to `/chat`"* — died three days later when `#1293` deleted that
whole subtree on a separate decision. Neither decision was wrong; they were simply never made
against each other.

The only thing that could still justify them was an **external** link — a bookmark, a home-screen
shortcut, a saved note — which no amount of grepping can see. The owner confirmed there is none, so
they are deleted.

**Re-verified before deleting rather than trusting the entry.** On current `main`: `grep` over every
`href`, `router.push` and `redirect` outside `app/sheet/` found zero referrers, and no test, sitemap,
`manifest.ts` or service-worker template names the paths. The only remaining mentions are in
`projectOverview.md` and past journal entries, which are the historical record and were annotated,
not rewritten.

Exercised on `pnpm dev` rather than assumed:

| URL | Before | Now |
|---|---|---|
| `/sheet/abc/config` | → `/config` | **404** |
| `/sheet/abc/overview` | → `/` | **404** |
| `/sheet/abc/workout` | → `/workout` | **404** |
| `/sheet/abc/workout?session=xyz` | → `/workout?session=xyz` | **404** |

and the live targets still answer: `/config` 307 (→ `/program`), `/program` 200, `/workout` 200,
`/` 200.

**No version bump and no changelog entry.** Nothing user-visible changed: the routes had no inbound
path from inside the app, and the owner has confirmed none from outside it.

## Q-232-followup — the More content stays inline

The IA plan's §2 table wanted `StatsGrid`, `TrophyCase`, `AchievementsSection`, "Your Year", the
season badges and `GoalsSection` moved behind `/more/achievements` and `/more/goals` rows. The owner's
call is to leave them on the surface.

The reasoning, recorded so it is not re-litigated: the size pressure that justified the earlier
splits is gone — `profile-tab.tsx` went 845 → 465 lines during Q-232 and is off the
`check-component-size.js` baseline — and unlike Settings/Data/About, these six are **content** rather
than navigation. Hiding content one tap deeper to satisfy a symmetry the plan drew is a downgrade.

`/more/achievements` and `/more/goals` were never built and now will not be. **The plan's §2 table is
annotated as superseded for rows 2–7 in the plan file itself**, not only here — a future session
reading the plan would otherwise re-derive the move from a table that still looks like a target.

## What this does NOT cover

Nothing here is device-verifiable and nothing needs to be: three deleted redirect files, plus docs.
The 404s were confirmed in the sandbox browser, which is exactly where a route table can be checked.
If a `/sheet/...` bookmark does turn out to exist on the owner's phone, it now 404s instead of
redirecting — that is the accepted consequence of the answer, and restoring one file would undo it.

## Verification

`npx tsc --noEmit` (after `rm -rf .next` — a stale `.next/types/validator.ts` keeps referencing
deleted routes and reports three phantom TS2307s) · `pnpm lint` 0 errors · `pnpm build` clean, 226
static pages, no `/sheet` route in the table · `pnpm check:rules` — **Ran 36 of 36** · unit suite
**478 files / 3,939 tests passed** · the route table exercised live on `pnpm dev` as above.
