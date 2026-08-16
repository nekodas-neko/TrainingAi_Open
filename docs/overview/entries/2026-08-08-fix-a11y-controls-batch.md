## 2026-08-08 — `fix/a11y-controls-batch` — Q-133 part 2: the 48dp floor, the browser confirm, the last emoji chrome

Closes **Q-133** (review [§4](../../reviews/2026-08-07-full-app-review.md)). Part 1 — `aria-expanded`
on the 12 disclosure toggles that genuinely lacked it — shipped in v1.270.17 / #1156. This is the
remaining four sub-items, so the backlog entry is **removed**.

### 1. The tap-target floor: 44px → 48dp, and it stays a global selector

The backlog proposed moving `app/globals.css`'s `button { min-height: 44px }` into
`components/ui/button.tsx` variants, per CLAUDE.md's "No global element-selector styling" rule.
**Checked, and that move would make things worse, so it was not made.** Every `Button` size variant
declares *less* than the floor — `sm` is `h-8` (32px), `default` `h-9` (36px), `lg` `h-10` (40px),
`icon` `size-9` (36px) — so the global rule is what currently rescues the entire design system, and
most of the app's controls are hand-rolled `<button>`s a variant would never reach. Moving it would
**shrink coverage, not tidy it**. The rule stays, with a comment stating why so the next reader does
not re-litigate it.

What did change:

- **44px → 48px**, the Android mandate it was under-delivering on.
- **`[role="button"]` added** — the gap the backlog named. That is the WebView nested-control pattern
  (a tappable card containing other controls, which cannot be a real `<button>`), so it needs the
  floor and could not get it from a `Button` variant either.
- **`<a>` deliberately still excluded.** An inline text link in prose is not a tap target and a 48px
  floor would wreck paragraph layout. Noted in the comment rather than left as an apparent oversight.
- `guided-walk/walk-config.tsx:192,195` — the `h-9 w-9` steppers the backlog flagged as "declared and
  effective sizes already disagree" now declare `h-12 w-12`, which is what they actually render.

**Measured, not assumed.** A DOM pass over every rendered `button`/`[role="button"]` on five screens
at the S25 viewport (412×915):

| screen | controls | under 48px | horizontal overflow |
|---|---|---|---|
| Home | 23 | 0 | none (scrollWidth 412) |
| More | 19 | 1 | none |
| Nutrition | 10 | 0 | none |
| Config | 26 | 1 | none |
| Session-select | 6 | 3 | none |

Every remaining "under" is a deliberate `.tap-dense` opt-out (the avatar camera badge; the workout
carousel's 7px dots). **No screen gained horizontal scroll** — the 4px bump does not overflow any
layout.

### 2. Four `window.confirm` calls → the `ConfirmDialog` primitive

`admin/exercise-unit-fix.tsx`, `oura-ble/step-backfill-console.tsx`, `oura-ble/db-footprint-card.tsx`
(×2). Each was restructured the same way: the button opens the dialog, and the async worker keeps its
guard clauses and runs from `onConfirm`. Two of the four gate genuinely destructive DB operations
(an unrecoverable step-count rewrite; nulling the `decoded` JSONB on every historical raw sample), so
the message text was carried over verbatim rather than paraphrased. `db-footprint-card` uses one
`confirm: 'backfill' | 'vacuum' | null` state for both dialogs; the VACUUM one is `variant="default"`
since it destroys nothing.

### 3. The last six emoji-as-chrome sites → Lucide icons

`profile/[userId]/page.tsx` (`🔥`→`Flame`) · `more/stats-grid.tsx` ×2 (`⚠️`→`AlertTriangle`) ·
`more/friend-leaderboard.tsx` (`👀`→`Eye`, **now with an `aria-label`** — it was the only marker that
someone is within striking distance and it had no accessible name) · `chat.tsx` ×2 (`💭`→a spinning
`LoaderIcon`, `🔊`→`Volume2Icon`) · `workout/exercise-stats-sheet.tsx` (`"Beat 1RM ⚡"`→ label + a
`ZapIcon`; its hardcoded `#00d4ff` also became `var(--accent-cyan)`).

**Two `⚠️` remain and are correct**: `chat.tsx:132` and `ai-chat-overlay.tsx:129` are inside AI
*message content*, which CLAUDE.md exempts as copy rather than chrome.

### 4. `chat.tsx` screen root

`bg-background` → `bg-page`, so the dynamic-background layer `pathnameToSection` renders behind it is
no longer hidden by an opaque paint.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors (100 pre-existing warnings) · `vitest run` **411/411 files,
  3249/3249 tests, nothing skipped** · all eight custom-rule scripts pass. Worth noting: the
  seeded-local-DB harness failure in `scale-ble-multi-reading.test.ts` (Q-146) that had been failing
  on every local run this session **passed here** — consistent with it being contention-dependent
  rather than a real defect, and a reason not to treat one green run as proof it is fixed.
- The tap-target DOM measurement above, plus full-page screenshots of the same five screens, run
  against `pnpm dev` as a logged-in user.

### Not exercised

**No device run.** That matters more than usual here: the 48px floor is a **CSS change affecting every
control in the app under 640px**, and it was verified on five screens in the web sandbox, not on the
S25. The four screens not measured (workout in progress, health, overview, guided-walk) may hold
dense control clusters that the extra 4px crowds — guided-walk in particular, since its steppers were
the ones relying on the floor.

The `ConfirmDialog` conversions were **not opened and clicked** — the admin and oura-ble consoles need
an admin session and live ring data the seeded local DB does not have. Their correctness is verified
in source (the dialog renders, the confirm handler is the original worker, the guard clauses survive),
not observed.
