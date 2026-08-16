# H5 — Perceived-performance & haptics sweep

> Source: `docs/planned_upgrades.md` § H5 (session-178 audit). Two PR-sized chunks: chunk 1 is standalone S-effort work, chunk 2 depends on H2/H4 primitives — do not start it before those land (or fold the needed primitive in explicitly). Re-grep anchors before editing.

## Chunk 1 — Standalone sweep (one PR, all S effort)

1. **Haptics coverage.** Wire the shared `lib/haptics.ts` helpers into the synchronous feedback path of: pull-to-sync (`hapticLight` at the `ready` threshold `pull-to-sync.tsx:120`, `hapticSuccess` on completion `:58` — the highest-value add), food-log save, mood check-in save, achievement/PR unlock toast, bottom-nav taps (`hapticLight`). Rule of placement: the same synchronous spot that fires the toast/mode-flip — never after an awaited fetch. Haptics helpers are already guarded dynamic imports; no new plugin work.
2. **Collapsible layout animation.** `components/ui/collapsible.tsx`: animate `CollapsibleContent` open/close via the `--radix-collapsible-content-height` CSS var (two keyframes in `globals.css`). One change upgrades every Radix-collapsible site; hand-rolled chevron toggles get this for free as G1 migrates them — no per-site work here.
3. **Samsung-WebView animation hazards.** (a) `macro-ring.tsx:35` animates SVG `stroke-dashoffset` — the exact banned pattern; convert to CSS `conic-gradient` (the donut pattern from session 55 already exists — copy it). (b) The ~7 `width`-transition progress bars (`home-card-widget.tsx:148,191,223,295`, `macro-ring.tsx:69`, `day-summary-card.tsx:40`, `assign-step.tsx:146`) switch to `transform: scaleX()` + `transform-origin: left` (compositor-only). ⚠️ On-device check required — this class renders fine in Chrome and breaks only on the S25.
4. **Compositor & reduced-motion leftovers.** Pause `ta-marquee` when offscreen (`animation-play-state` toggled by an IntersectionObserver, or `content-visibility: auto` if it suffices — try the CSS-only route first per the prefer-premade rule); add `shimmer-sweep`, `pr-pulse`, `xp-pop` and the converted bars to the `prefers-reduced-motion` block H4 introduces (if H4 hasn't landed, create the media block in `globals.css` now — it's additive).

**Verify:** `pnpm dev` — every save/tap listed fires haptic feedback within its synchronous handler (web no-ops but the call sites are verifiable + unit-greppable); collapsibles animate; macro ring and progress bars visually identical. Declare: haptic feel and the Samsung compositor behaviour are device-only checks (S25, both themes).

## Chunk 2 — After H2/H4 land (one PR)

5. **Tap-driven page transitions.** Extend H2's `document.startViewTransition` + directional CSS from edge-swipe to nav taps and card `router.push` sites (shared helper `navigateWithTransition(router, href, direction)` so the transition logic exists once). ⚠️ Verify on the APK with a dynamic background active — view transitions snapshot the root and the particle layer can flash; if it does, scope the transition to the content container per H2's approach.
6. **Skeleton→content fade-in.** CSS-only (`@starting-style` or an opacity keyframe applied to content containers as they replace skeletons). Implement as one utility class in `globals.css` + apply at the ~5 highest-traffic screens first (home cards, health tabs, nutrition) rather than all ~47 skeleton files in one diff — the rest convert on touch.
7. **In-screen tab-panel crossfades.** One small `<TabPanels>` primitive reusing H4's fade pattern; adopt it where G1's `<SegmentedTabs>` lands so the two primitives ship as a pair rather than 17 call-site edits twice.
8. **Count-up numbers.** Once H4's `useCountUp` exists: home stat tiles (`home-card-widget.tsx`), weekly-stats hub, stats totals, detail-hero scores. Respect reduced-motion (render final value instantly).

**Verify:** navigation transitions at 60fps on-device with wallpaper active; reduced-motion setting disables all of it; no layout shift from the fade-in utility.

## Wrap-up (per chunk)

- `pnpm tsc --noEmit && pnpm lint && pnpm test`; manual pass of every touched surface on `pnpm dev`.
- Unexercised in sandbox (declare in PR): haptic output, Samsung WebView compositor rendering, view-transition behaviour over the dynamic background — all S25-only checks; chunk 1's bar/ring conversions specifically exist *because* Chrome hides the failure.
- Patch/minor bump + changelog per chunk; tick H5 items in `planned_upgrades.md` as they land.
