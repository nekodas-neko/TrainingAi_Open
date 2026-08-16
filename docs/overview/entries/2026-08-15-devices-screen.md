# 2026-08-15 — the Devices screen (Q-233)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.309.0
**Plan:** [`2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md) §3, step 1 of its build order.

Ring, chest strap, scale and the background-location permission were four cards stacked between
"Goals" and "Settings" in the More scroll. So the answer to *"is my ring connected and what is its
battery?"* was "scroll two-thirds of the way down More → Profile". They are one screen now,
`/more/devices`, reached from a single row.

This is step 1 deliberately: the smallest real win, and it proves the sub-route pattern before
anything larger depends on it.

## Three things the plan did not anticipate

**All four cards already render their own uppercase heading.** The first version wrapped them in
`SectionHeader label="Paired devices"` and `label="Permissions"`, which produced
*PAIRED DEVICES / INTEGRATIONS / Oura Ring 5* — a heading above a heading. Dropped both; the screen
title is the grouping.

**`BackgroundLocationCard` returns `null` off-device** (`Capacitor.isNativePlatform()` gate), so the
"Permissions" heading sat above nothing in the web sandbox — and would do the same on any device
where the permission check is unavailable. Caught by reading the rendered text rather than the
source. This is the second reason the wrapper headings are gone.

**The size ratchet fired, and it was right.** Replacing four component tags with a row grew
`profile-tab.tsx` from 845 to **850** lines, over its `check-component-size.js` baseline. The fix was
not to raise the number: the row markup was now the *second* copy of the Admin row's markup, so it
became `components/more/more-row.tsx` (`MoreRowGroup` + `MoreRow`), both call sites use it, and the
file is **835** lines. Baseline ratcheted 845 → 835 in the same commit. That primitive is the
grouped-list row the rest of the plan needs, arrived at because the check refused the lazy option.

## One string changed inside a moved component

`oura-section.tsx`'s heading said **"Integrations"**, which was accurate beside Settings and is not
on a screen called Devices — it is the ring. Now "Ring". The plan said "no changes to the components
in the first pass"; this is the one exception and it is a heading string, not behaviour.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings) · `pnpm build` (`/more/devices` in the route
table at 11.7 kB) · **`pnpm check:rules` — Ran 35 of 35** · `check-component-size` and
`check-hex-literals` both clean · full suite **471 files / 3,899 tests green**.

`pnpm dev` at 412×915 as `test@local.dev`, full flow:

- More shows the **Devices** row and **no** inline pairing cards.
- Tapping it → `/more/devices`, rendering *RING / Oura Ring 5 · HEART-RATE STRAP · BODY-COMPOSITION
  SCALE*.
- Back → `/more`.
- Zero console errors throughout.

**⚠️ Not device-verified, and this screen has more riding on that than most.** It is navless, so its
trailing padding is `pb-safe-action-lg` (floored at 4rem) rather than a bare `pb-safe` — every card
here ends in a tappable pairing control, and Android gesture-nav insets report near zero. The web
sandbox renders insets as 0, so that clearance is unproven. `BackgroundLocationCard` also cannot
render at all here, so the Permissions half of this screen has never been seen.
