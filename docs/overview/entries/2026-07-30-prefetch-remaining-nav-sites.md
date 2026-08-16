# 2026-07-30 — Prefetch the remaining button-driven navigations

Branch: `perf/prefetch-remaining-nav-sites` · v1.242.1

Closes the orphaned half of #919. Plan:
[`docs/superpowers/plans/2026-07-29-prefetch-remainder-and-applydelta-batching.md`](../../superpowers/plans/2026-07-29-prefetch-remainder-and-applydelta-batching.md).

## Why

`<Link>` prefetches on viewport entry; `<button onClick={() => router.push(href)}>` gets nothing, so
the destination's RSC fetch starts at tap time with the view transition already frozen waiting on it.
#919 proved this and fixed the four Home score circles plus three sibling Health surfaces. Its journal
noted that all 21 `useTransitionRouter` call sites are buttons but filed nothing about the rest — an
orphaned finding under the standing rule.

## What the remainder actually was

Not 17 sites. Auditing all of them:

- **7 use the router only for `.back()`** — nothing to warm (`pre-workout-screen`,
  `pre-activity-screen`, `year-review-content`, `session-explain-content`, `session-explain-empty`,
  `health/timeline`, `profile/[userId]`).
- **3 declined** — `profile-tab` (`/year-review`, `/admin`), `ai-prescription-card`
  (`/config?new=program`), `admin-content` (three `/admin/*`). Rare, admin-only, or heavy; a prefetch
  is a real payload fetch and these are not hot paths.
- **7 converted**, below.

| site | warmed | note |
|---|---|---|
| `session-select-content` | `/workout?session=<recommended>` | the app's primary daily action |
| `workout-select-content` | `/workout?session=<visible>` | carousel — exactly one session is startable at a time, re-warmed on swipe |
| `modality-picker` | `/running`, `/activity/guided-walk` | both static; the picker exists to reach one of them |
| `time-picker-sheet` | `/running`, `/activity/guided-walk` | both reachable regardless of the recommendation — explicit Run/Walk buttons sit next to the recommended Start |
| `log-activity-sheet` | `/activity`, `/activity/guided-walk` | every exit is one of the two; mounts only on open |
| `walk-summary` | `/activity` | Done is the only way off the screen |
| `running-plan-content` | `/activity` | starting the prescribed run hands off there |

**Deliberately not warming every session in the list.** `session-select` renders the full active-session
set; warming all of them is N payload fetches to serve one tap. Only the recommended session is warmed.

## Verified — and a correction to #919

**`router.prefetch` is inert in `next dev`.** Against the dev server this branch produced **zero**
prefetch requests; the identical code against `pnpm build && pnpm start` produced exactly one per
screen:

| screen | RSC prefetch before any interaction |
|---|---|
| `/workout-select` | 1, at +137 ms |
| `/` (session-select) | 1, at +330 ms |

One request each — the warm fires on mount and does not over-fetch.

**This retroactively corrects #919's measurement.** That PR's 190→118 ms time-to-motion figure was
measured against `pnpm dev`, where prefetch does nothing — so the improvement it recorded came
**entirely from the commit-poll fix**, and the prefetch half of that PR was shipped unmeasured. The
prefetch is still correct and does work in production; it simply was not what moved those numbers.
Any future navigation-latency measurement must run against a production build.

`pnpm tsc --noEmit` clean · `pnpm lint` 0 errors (119 pre-existing warnings) · 2789 tests pass ·
`pnpm build` exit 0.

## Not verified

- **Device.** Chromium is not Samsung's WebView, and the APK loads the Railway URL over a real
  network. Prefetch behaviour should be identical (it is Next-level, not WebView-level), but the
  latency benefit is unmeasured on device.
- **The three declined sites** are a judgement call about payload cost vs tap likelihood, not a
  measurement. If `/year-review` or `/admin` ever feel slow to open, they are the first candidates.

## Related work not done here

The second gap from the same audit — `applyDelta` issuing one Capacitor bridge round-trip per row —
is **not** implemented. It is filed as Q-28 with its design in the plan doc above. It was left out
deliberately: its benefit is confined to initial-sync/restore and is currently **unmeasured**, and
the row-count measurement the plan calls for cannot be taken in-session (no reachable production
data, and native SQLite does not run in the sandbox). Shipping a large refactor of the repo's most
data-loss-prone path for an unquantified win was the wrong trade.
