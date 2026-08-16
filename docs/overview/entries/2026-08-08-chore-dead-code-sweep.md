## 2026-08-08 — dead code deleted; the four decisions left as decisions (Q-136, part 1)

**Branch:** `chore/dead-code-sweep` · **Domain:** `app-shell` / `platform`

The backlog entry opens with *"do not delete blindly — two of these are decisions, not cleanups."*
This PR takes only the mechanical half. **Q-136 stays open** for the rest; the entry is annotated,
not removed.

### Deleted (each verified to have zero references first)

| Path | Lines | Why |
|---|---|---|
| `app/api/oura/debug` | 1 route | Debugs the Oura **Cloud** pipeline, dead by design since the BLE re-key. 0 refs repo-wide |
| `app/api/admin/seed-exercise-gifs` | 122 | Superseded by `admin/mirror-dataset-gifs`, which has real UI at `exercise-manager.tsx`. 0 refs |
| `app/api/admin/test-exercise-image` | 142 | A prompt-tuning scratchpad. 0 refs |
| `app/api/admin/list-ai-models` | 34 | A one-off dev lookup. 0 refs |
| `app/stats/stats-content.tsx` | 389 | **Zero importers.** Flagged in `uplift-archive.md:397` and never actioned |
| `app/history/page.tsx` | 5 | A redirect to `/stats`, which is itself a redirect — a shim to a shim, no inbound links |

References were checked with a repo-wide grep across `app`, `components`, `lib`, `packages`,
`scripts` and `.github` before each deletion, not just by trusting the entry.

### One thing worth flagging: this discards work Q-134 landed hours earlier

`admin/seed-exercise-gifs` and `admin/test-exercise-image` had rate limits added by **#1146 (Q-134)**
earlier today. Q-134's own entry anticipated this — *"Two of them are also deletion candidates under
Q-136 — resolve that first and this may shrink to three"* — but the order ran the other way, so those
two rate limits are deleted along with the routes. Nothing is lost that matters (both routes are
unreachable), but it is the other agent's work going away and should not happen silently.

### `/stats` is NOT dead — only its content component is

Worth recording so nobody deletes the wrong thing next time. `app/stats/page.tsx` is a live redirect:
`session-select-content.tsx:455` has `handleNavigateStats` → `router.push('/stats')`, wired to a
control at `:1307`. The **page** stays; only the orphaned 389-line `stats-content.tsx` goes.

### Deliberately NOT done — these are decisions, not cleanups

- **`app/health/timeline/page.tsx`** (151 lines, orphaned since creation in #1074). The entry says
  *"either wire it up or delete it; it cannot stay as-is."* Both options are product calls: the home
  widget already links to `/nutrition?date=` and `/health?tab=body&openSleepDate=` instead, so wiring
  it up means deciding it should exist, and deleting it discards a built screen. Left for the owner.
- **`app/api/sync/oura-timeseries`** — half a feature; `sync-engine.ts:640` says the client driver is
  *"not yet wired"*. Deleting it forecloses the Track-B pull.
- **`app/api/oura/webhooks`** — no UI was ever built, but registration happens automatically at
  `oura/callback:66`, so removing the routes removes the only way to list or delete subscriptions.
- **The `/sheet/[id]/*` shims** — explicitly *"decide the two subtrees first"*. They are the only
  inbound path to `/chat` (sole caller of the TTS route) and `/overview`.
- **`admin/backfill-derived-scores`** — the entry says outright: do not delete, it is a curl-only ops
  tool by design.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors (warning count drops 120 → 119 with the dead file gone)
  · `vitest run` green apart from the known seeded-local-DB failure in
  `scale-ble-multi-reading.test.ts` (filed by me as Q-141 — a number already claimed by open PR #1143; correctly refiled as **Q-146**, and since fixed by #1160).
- A post-deletion grep for each deleted route name across the whole repo returns nothing.

### Not exercised

No device run — deletions only, no native, safe-area, gesture or notification path.

**Nothing was exercised in a browser**, because there is nothing new to look at: every deleted path
had zero inbound references, so the intended observable effect is that nothing changes. The risk this
does not cover is a caller that reaches these routes by a string the grep could not see — a hardcoded
URL in Tasker, a bookmark, a curl in someone's shell history. `admin/*` and `oura/debug` are exactly
the shapes that get called that way, so if an ops script starts 404ing, this is why.

---

## Correction: I claimed a Q number that was already taken

The seeded-local-DB test defect found while running the gate for Q-119 was filed as **Q-141**.
That number was **already claimed by open PR #1143** (AI chat drops the chart on a "show on a
chart" follow-up). The backlog header says explicitly to claim against the open-PR list and not
just this file — the same discipline CLAUDE.md sets for migration numbers — and I checked only the
file.

The duplicate was caught by the agent working the platform half, who refiled the same finding
correctly as **Q-146** and fixed it in **#1160** (the test now creates the account it tests
against instead of borrowing an arbitrary one; verified 12/12 locally against the seeded dev DB).
My duplicate entry is removed here, and every journal entry of mine that cited "backlog Q-141" now
says what actually happened rather than pointing at someone else's item.

**For the next agent:** a Q number is claimed against the queue file *and* every open PR. Grep the
open-PR list before taking one.
