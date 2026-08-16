# 2026-08-15 — the More-tab IA plan, and the deep link it found broken (Q-232, Q-239, Q-256)

**Branch:** `claude/ia-cluster-app-shell` · **Docs-only, no version bump.**

Q-232's entry forbids executing it from the entry: the five IA items share one target structure, and
working them one at a time leaves the app half-reorganised in two incompatible directions. So this
PR is the plan —
[`docs/superpowers/plans/2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md)
— covering Q-232, Q-233, Q-234, Q-235, Q-237 and the Q-239 decisions together.

## What the plan settles

**The target is the standard grouped-list pattern**, each row a real sub-route so it is
deep-linkable, back-navigable and carries its own header: Achievements & Stats · Program · Devices ·
Goals · Settings · Data & Sync · About · Feedback · Admin · Sign Out. The plan maps all sixteen of
today's `profile-tab.tsx` sections to their destination.

**Row 13 is the one that has to be split rather than moved.** "Restore from cloud" and "Export my
data" currently sit under an *About* heading beside the version string. They are the clearest single
instance of the owner's complaint, and they go to `/more/data` where a destructive-sounding action
reads as one.

**The cost claim was checked, not assumed.** Every section is already an extracted component —
measured, ten of them totalling 2,053 lines — so this is routing and composition, and no screen's
internals get rewritten. It retires the 845-line `profile-tab.tsx` hotspot as a side effect.

**Admin splits by audience, not by tidiness:** user administration (users, invites, feedback) stays
at `/admin`; developer diagnostics (BLE debug, cadence, data capture, backfills, model assets, error
log, AI usage) move to Settings → Developer. Those are debug tools for the owner's own device, used
far more often than user admin, and they are the deepest-buried things in the app.

**Build order is in §8** and is chosen so nothing is half-moved across a merge boundary: Devices
first (smallest, proves the sub-route pattern), then the Settings/Data/About split, then
Achievements/Goals/Profile, then `/program`, then Settings → Developer. Nutrition is independent.

## Q-239: five of six are "leave", and that is the deliverable

The entry asks for a decision per screen, not a refactor. Re-measured reachability and decided:
`/baselines`, `/year-review`, `/session-explain`, `/health/day` and `/running` each stay — each is
genuinely the detail view of the card that owns it, and promoting any of them creates a screen with
no context. `/running` in particular sits behind a modality picker that is a real choice among peers;
shortcutting one makes the others look secondary.

Only `/admin/{cadence,data-capture,oura-ble}` was misplaced, and that is already Q-234's job.

Writing "leave" down is the point. The next reachability sweep will surface these same six, and
without the table it re-opens a settled question. The entry stays until Q-234 lands, then gets
struck.

## Q-256: a deep link that has been silently dead

Found while enumerating the Program Builder's entry points, not looked for.

`components/workout/ai-prescription-card.tsx:337` sends the post-deload "New program" action to
`/config?new=program`. `app/config/page.tsx` does a bare `redirect('/more?tab=workout')` — which
**drops the query string** — and `config-screen.tsx:357-364` reads `?new=program` from
`window.location.search` to open the new-program sheet. It never sees it.

**Measured in `pnpm dev`:** `/config?new=program` lands on `/more?tab=workout` with the program list
rendered and no sheet open. The action degrades silently to "open the Program Builder".

Same class as **Q-223** — the `/config` shim losing information on the way through — and the second
instance. Filed as **Q-256** and deliberately *not* fixed here: Q-235 rewrites these redirects
anyway, and fixing it now would be immediately re-touched. The plan records the design rule that
prevents a third instance: when `/program` exists, take deep-link params as **route params** rather
than reading `window.location.search`, so a redirect that forgets to forward them fails visibly.

## Verification

Docs-only — no code changed. `pnpm check:rules` **Ran 35 of 35** (including the doc-link and
CLAUDE.md-paths checks). The one runtime claim in this PR, the `/config?new=program` behaviour, was
measured against the live dev server rather than read off the source.

**A gotcha that cost time twice today:** running `pnpm build` while `pnpm dev` is up corrupts the
shared `.next` and every route starts 500ing with
`Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` or missing `_buildManifest.js.tmp`
files. It looks exactly like the change under test broke the app. `rm -rf .next` and restart dev.
