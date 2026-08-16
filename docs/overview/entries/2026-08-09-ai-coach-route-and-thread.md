# 2026-08-09 — AI Coach Phase 2: the route, the thread, and history

**Branch:** `claude/health-metrics-button-designs-hy6cyv` · **Q-157 phase 2 of 3** · Phase 1's
protocol is now reachable.

## What shipped

- **`/coach`** (`app/coach/page.tsx` + `coach-content.tsx`) — a full page, not the 78vh sheet.
  `useChat` from `@ai-sdk/react`, which was a dependency with zero imports until now.
- **The resolved-widget collapse.** Tap an option and the picker is replaced by a normal user
  bubble carrying the label, with an undo glyph that re-opens it. This is the behaviour the whole
  design rests on and it works.
- **Persistence** — migration 172 (`coach_threads`, `coach_messages`), `lib/coach/threads.ts`,
  `/api/coach/threads`. Whole UI message **parts** are stored, so a rehydrated thread keeps its
  widgets. 30-day window, pruned on write (there is no cron layer).
- **`gemini-3.6-flash` for Coach only** (`COACH_MODEL_ID`), plus **Google Search grounding** with
  source links rendered under grounded answers.
- **Offline state** — explicit card, disabled composer, unsent text preserved.
- **All entry points repointed** and the old overlay deleted.
- Migration 173 regenerates the `claude_ro` views for the two new tables.

## Corrections to what was planned

- **Three entry points, not four.** Stats' AI button was deleted on `main` in Q-136 between the
  plan being written and this being built. Home (`/overview`), the home tab's floating button
  (`session-select-content`) and the workout done-screen are the live set.
- **`useSearchGrounding` no longer exists** in `@ai-sdk/google` v3 — grounding is a provider tool
  (`google.tools.googleSearch({})`). The open risk was that Gemini historically could not combine
  search with function declarations; **measured 2026-08-08 that it can** — two probe prompts
  returned 3 and 7 sources with 16 function tools also declared.
- **The FAB was extracted** to `components/coach/coach-fab.tsx` rather than inlined: adding it put
  `session-select-content.tsx` one line past its recorded 800-line-hotspot baseline, and the rule
  is extract, not append.

## Two bugs found by looking rather than by testing

1. **Every `<Switch>` in the app renders as a black circle.** The global 48px tap-target floor in
   `globals.css` applies to `button`, and Radix's Switch root *is* a button — so `h-5 w-9` loses and
   the control becomes a 48×48 `rounded-full` blob. Proved with a minimal repro before touching
   anything. **This is not new to Coach**: `components/profile/goal-recommendation-sheet.tsx` has
   rendered this way for as long as both have existed. Fixed in the shared primitive — `tap-dense`
   restores the pill and a `before:` pseudo-element puts a 48px touch area back, so the control
   looks right *and* stays reachable.
2. **Every conversation in history read "0 messages".** A correlated subquery in the SELECT list
   returned 0 for every row while the identical SQL by hand returned the right counts — Drizzle's
   interpolation was not producing the correlation. Nothing failed; the UI was just quietly wrong.
   Replaced with a grouped second query, and the count now has a test.

Neither would have been caught by the test suite or by the build. Both came from rendering the
screen and reading it.

## Verification

Signed in against the dev server at 412×891, in both themes:

| Check | Result |
|---|---|
| Full suite | 420 files / 3316 tests green |
| `pnpm build` | compiles; `/coach` 11.1 kB, all five `/api/coach*` routes emitted |
| Lint + all 9 custom-rules scripts | pass |
| "Change my workout" | session list with **real** UUIDs, colour keys, subtitles |
| Tap an option | collapses to a user bubble; next widget renders |
| Specific ask | skips the ladder straight to a proposal |
| Apply | consequences measured from real data; DB verified changed |
| History | applied changes + conversations, correct counts |
| Entry points | all three resolve to `/coach`; FAB is 56dp |
| Composer | 64px clearance below it (the `pb-safe-action-lg` floor) |
| Dark mode | clean |
| Page errors | none |

**Not verified on device.** Every safe-area inset renders as 0 in the sandbox, and this is a navless
full-screen route with a bottom-anchored composer — the exact shape that has regressed 11+ times.
`docs/device-smoke-checklist.md` has a new **AI Coach** section covering it; the composer-clearance
line is the one that matters.

## Left open

- Phase 3: the remaining widgets and write domains, and the tier-3 pushed confirmation screen.
- `/api/ai-chat/route.ts` still exists (its `tts` child route lives under the same tree) but nothing
  calls it now. Removing it, and any of `lib/ai-chat/context.ts` that Coach does not use, is a
  cleanup for Phase 3.
- A long widget prompt truncates in the widget header. Cosmetic; the fix is a terser prompt.
