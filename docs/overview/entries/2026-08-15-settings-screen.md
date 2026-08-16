# 2026-08-15 — Settings gets a screen, and profile-tab leaves the size baseline (Q-232, step 3)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.311.0
**Plan:** [`2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md) §2, step 3.

Preferences (six switches), Theme & Appearance and Home Widgets were three collapsibles inline in
the More scroll. They are `/more/settings` now, behind one row.

## `profile-tab.tsx`: 845 → 465, and off the baseline

The file that opened this cluster as one of six `check-component-size.js` hotspots is **465 lines**
and **its BASELINE row is deleted** — the script's own rule, since a row left behind for a file now
under the limit turns the ratchet into an allowlist. Five hotspots remain.

The plan predicted this ("retires the 845-line file without an artificial split"). It happened
without one: nothing was chopped to hit a number, four screens were carved out along the seams the
IA already implied.

| Step | Moved out | Lines after |
|---|---|---|
| Q-233 | four device cards → `/more/devices` | 835 |
| step 2 | Sync/Restore/Export → `/more/data`, version+changelog → `/more/about` | 697 |
| step 3 | preferences + appearance + home widgets → `/more/settings` | **465** |

## What moved, and why it was safe to move it whole

Ten pieces of state and nine handlers went to `components/more/settings-panel.tsx`. Every one of
them was **only** read inside the block that moved — checked before cutting, not after. Every value
they set is a `localStorage` flag some *other* screen reads (`ta_pref_rest_chip`,
`ta_pref_run_chip`, `ta_pref_calendar_sync`, `ta_pref_day_review_reminders`,
`ta_pref_health_alerts`, `ta_pref_push_enabled`), so nothing in the More tab depended on the state
staying there.

Both `useEffect` hydration effects moved with it, unchanged — including the split into two effects,
which is preserved rather than merged.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings; sixteen imports that became unused were removed) ·
`pnpm build` (`/more/settings` 10.6 kB in the route table) · **`pnpm check:rules` — Ran 35 of 35** ·
`check-component-size` now reports **5** hotspots · `check-hex-literals` clean · full suite
**471 files / 3,899 tests green**.

`pnpm dev` at 412×915 as `test@local.dev` — the toggles were **operated**, not just rendered:

- More shows the **Settings** row; no inline Preferences / Theme / Home Widgets.
- `/more/settings` renders all three collapsibles.
- Expanding Preferences shows all six switches with their descriptions intact.
- **Toggling "Rest Timer in Status Bar" wrote `ta_pref_rest_chip = "false"`** — read back out of
  `localStorage`, which is the whole contract these switches have with the rest of the app.
- Expanding Theme & Appearance renders the colour picker and background settings.
- Back returns to `/more`. Zero console errors throughout.

**⚠️ Not device-verified.** Three things the sandbox cannot reach: the `pb-safe-action-lg` clearance
on four navless sub-screens; the push toggle, which calls `subscribeToPush()` and needs a real
service-worker registration and permission prompt; and whether the preference flags are read
correctly by the *native* surfaces that consume them (the status-bar pill for
`ta_pref_rest_chip` / `ta_pref_run_chip`). The write side is proven here; the read side is not.
