# 2026-08-09 — AI Coach can start a deload, and a Q number that landed twice

**Branch:** `fix/coach-followups-q-number` · **Q-168 (partly)** · **v1.274.0**

## The sixth write domain

`early_deload`. Say you are beaten up and Coach proposes starting the deload week now; say it is
over and it proposes cancelling. Tier 2 — inline, undoable.

**It is a write domain, not the `handOff` the backlog entry called for.** The obvious wiring was a
link to the `EarlyDeloadCard` on `/session-select`, and it would have been a dead end: that card
renders only when `readiness.earlyDeloadRecommended` is already true, which is exactly the case
where the user has no reason to ask. Handing someone to a screen whose button may not be there is
the failure the `HandoffSchema` comment warns about.

**The model does not supply the date.** The field is the boolean `deloadNow` and the server stamps
today in the user's own timezone. A model-authored date here would be a UTC-flavoured guess written
into a stored column — the exact shape of the bug CLAUDE.md's timezone rule exists to prevent. So
`handlerFor`, `applyCoachPatch` and `previewPatch` now take `today`, and both routes pass
`todayInTz(session.user.timezone)`.

**Why tier 2 and not tier 3.** It is undoable, and the app already confirms the same action in a
single tap on the home card. Making Coach demand a hold-to-confirm would have made it heavier than
the button it stands in for. `program_phase` keeps tier 3 for the reason it always had: that one
can move you backwards through a block you have earned.

## The consequence nobody expects

Flagged sessions are excluded from **every** cycle count in `slices/programs.ts`. So starting a
deload on a day you have already trained silently stops that work advancing the block. The preview
says so and counts the rows:

> 1 session logged today stops counting toward your cycle

Which is also why undo restores the `is_early_deload` flags by id, not just the date column.

## A Q number that landed twice

Phase 3b filed its follow-ups as Q-166 — and **so did #1194**, which merged in the same window.
`main` carried two `Q-166` headings at once. Renumbered here to **Q-168** (167 was taken too, by
the contrast review).

The renumber-at-write-time habit is what failed: the number was re-grepped when the entry was
written, then sat through CI while two other sessions took numbers. The counter note now says to
grep for your own number *after* merging, which is the only check that would have caught this.

## Verification

Signed in against the dev server:

| Check | Result |
|---|---|
| Full suite | 422 files, **3351 tests** green |
| `pnpm build` | compiles |
| Lint + all custom-rules scripts | pass |
| Preview, 1 session logged today | "1 of 3 sessions into this cycle — starts 2 sessions early" + the warn line |
| Apply | `early_deload_week_start = 2026-08-09`, 1 session flagged |
| Re-apply the same patch | **409 stale** |
| Undo | date null, flags back to 0 |
| Live model, "I am completely beaten up… I need to deload now" | read state, then proposed `early_deload` — first try |
| New DB-backed tests | 6 |

**Not verified on device.** No new screen — this is a card in the existing thread — so the standing
AI Coach Known-Issues row still covers it. Nothing here touches native, safe-area or offline paths.
