# Safe-area round 2 — nav clearance gap + adoption audit

> Source: user report (2026-07-04, Health → Body screenshot: the "HRV vs Baseline"
> card butts flush against the bottom nav). The safe-area **system** shipped in
> session 193 (PR #152) — canonical `pb-nav-safe` / `pb-safe-action` utilities +
> a CI rule blocking raw `safe-area-inset` outside `bottom-nav.tsx`. This is the
> follow-up polish: the catch-all utility exists and is applied, but its value
> leaves **zero visual gap**, and adoption isn't universal.

## Root finding (why it still looks tucked even "with the catch-all")

- Bottom nav (`components/shell/bottom-nav.tsx:52-53`): a `fixed bottom-0` `<nav>`
  with `pb-[env(safe-area-inset-bottom)]` wrapping an inner `flex h-14` (56px). So
  its rendered height is **56px + inset**.
- `.pb-nav-safe` (`app/globals.css:334`): `calc(3.5rem + env(safe-area-inset-bottom, 0px))`
  = **exactly 56px + inset**. It reserves the nav's height and nothing more, so a
  scroll container's last child sits **flush** against the nav — no breathing room.
- The center Workout FAB is elevated `-top-4` (16px above the nav,
  `bottom-nav.tsx:75`), so it floats over any content in the top 16px strip of the
  nav zone — the flush last card sits partly under it.

Net: screens that correctly use `pb-nav-safe` (e.g. Health's three tab scroll
containers, `health-content.tsx:657/674/691`; **Home/session-select** at
`session-select-content.tsx:926`) still read as cramped. It's not a
missing-utility bug there — it's the utility's value. The user has since confirmed
the clip happens on **Home too**, not just Health — i.e. it's the shared utility,
which is exactly why bumping its value (Task 1) fixes every screen at once.

## Task 1 — Give `pb-nav-safe` a real breathing gap

`app/globals.css`, `.pb-nav-safe`:

```css
.pb-nav-safe {
  /* nav is h-14 (56px) + its own safe-area inset; add a gap so content clears
     the nav (and the -top-4 elevated FAB) instead of butting flush against it. */
  padding-bottom: calc(3.5rem + env(safe-area-inset-bottom, 0px) + 0.75rem);
}
```

(0.75rem chosen to match the app's standard card gutter; tune to taste. This is
the single highest-impact change and fixes every screen already on the utility at
once.) The 3.5rem portion is verifiable in the web sandbox at the S25 viewport;
the inset portion is device-only (sandbox reports inset 0).

## Task 2 — Adoption audit (catch the screens that never got it)

Session 193 added the utilities and a CI rule, but didn't guarantee every scroll
container adopted `pb-nav-safe`. Sweep and fix the stragglers:

- Grep every main scrollable container (`overflow-y-auto` / `overflow-auto` /
  `flex-1` scroll roots) on nav-bearing screens (Home/session-select, Health,
  Nutrition, More, workout-select, overview, timeline, history, admin, profile)
  and confirm each ends in `pb-nav-safe`. List + fix any missing.
- Confirm bottom-anchored action bars / sticky footers use `pb-safe-action`
  (or `-lg` for the workout Start/Complete bar), and sheets inherit the baked-in
  `pb-safe-action` from `SheetContent[side="bottom"]`/`SheetFooter`.
- Consider strengthening the CI rule (or adding a lint) to flag a nav-screen
  scroll container that lacks `pb-nav-safe`, so this can't regress screen-by-screen
  again — optional, only if a cheap heuristic exists.

## Wrap-up

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; `pnpm dev` at the S25 viewport —
  confirm the last card on Health Body/Training/Progress (and each audited screen)
  clears the nav with a visible gap.
- **Device-only (declare in PR):** the real `env(safe-area-inset-bottom)` value +
  the FAB-overlap check only render on the S25 (sandbox reports inset 0, so only
  the fixed-rem gap is visible in the web sandbox). Run `docs/device-smoke-checklist.md`.
- Patch bump + changelog (user-visible layout fix); low-risk, exempt from the
  merge-confirmation gate.
