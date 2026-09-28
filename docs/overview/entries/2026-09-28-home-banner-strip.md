# 2026-09-28 — RV-119: Home's banners split by severity, four behind one strip

**Lane B.** Branch `fix/home-banner-stack-collapse`. v1.481.0. Batch `home-ia-merge`, closed.

## What shipped

Built to [`docs/design/2026-09-28-home-banner-stack.html`](../../design/2026-09-28-home-banner-stack.html)
option **A**, which the owner picked on 2026-09-28.

- **`components/home/home-banner-stack.tsx`** (new) — the stack, extracted out of
  `session-select-content.tsx`, which also clears the queued file-size task on those lines.
- **`components/home/home-banner-strip.tsx`** (new) — the collapsed row: icon chips, a count, a
  chevron.
- **`components/home/home-banner-presence.tsx`** + **`home-banner-keys.ts`** (new) — the registry.

**Two stay full-width, and the split is by severity rather than by height.** The illness advisory
and the early-deload warning are things he should see *today*; collapsing them beside a weekly recap
is how they get missed. The other four — an activity to review, the goals check-in, the day review,
the weekly recap — are all "ready for you", which is what makes grouping them honest.

**The failure was cumulative, not individual.** Each banner self-hid and each was correct alone; on a
Monday after a detected walk with an early-deload flag he scrolled past five cards to reach the
recommendation, which is the thing he opens Home for.

## The problem the entry does not mention

**Two of the four decide their own visibility and `return null`.** `ExerciseDetectedCard` reads its
own pending sessions; `WeeklyRecapBanner` its own dismissal, and whether a recap exists at all is
decided one level further down, in its child. From outside, all four look parent-controlled — so a
strip that says *"4 ready"* and draws one icon per waiting banner has no way to know what to draw.

Hoisting those reads into the parent would duplicate two non-trivial conditions and give them a
second place to drift. So each banner keeps deciding for itself and **reports**:
`useReportBannerPresence(key, present)`, above its early return because a hook cannot be skipped, and
a no-op outside Home's provider so each component still works anywhere else.

**And the two that *are* parent-controlled never get to report for themselves** — when their
condition is false they are not rendered at all — so the stack reports those. Missing that half
undercounts the strip *silently*: it still renders, just with fewer icons and a smaller number,
which looks exactly like a correct quiet day. I shipped the first version without it.

## The structural call the entry left to me

**The four are hidden, not unmounted, and they keep their own dismiss controls.** The entry lists
losing those as the accepted cost of option A. It is not paid here: expanding shows the real
banners, with the controls they already have. Unmounting would also take them out of the registry
the count comes from, so this is load-bearing twice over.

The strip itself has **no dismiss** — it is an expander, which is what the mockup draws (a chevron,
not an ×). A "dismiss all" would let one tap hide four unrelated things, and two of them
(`goalsCheckin`, `dayReview`) already have their own per-day dismissal.

## Verified

- **`components/home/__tests__/rv119-banner-stack-split.test.ts`** — 5 tests pinning the severity
  split: the illness advisory is not in the stack at all, the early-deload card is in it but *not*
  inside the collapsed container, all four agreed banners are, and they are hidden rather than
  conditionally rendered. It self-checks that it found the container, so it cannot pass by matching
  nothing.
- **`e2e/rv119-home-banner-strip.spec.ts`** — at 384 px: the strip renders, reports a real count,
  the four are hidden while collapsed, tapping expands **in place** (URL unchanged), the expanded
  banners still carry their own controls, and it collapses again.
- **Control-run three ways, each mutation asserted as applied:** the early-deload card moved behind
  the strip → *"it is a today thing, by the owner's split"*; the four conditionally rendered →
  the container self-check fires; the parent reverted to `main` → *"the banner strip never
  rendered"*.
- Rendered at 384 px dark: `1 ready` with the recap's icon, expanding to reveal the banner.
- `tsc` clean · `pnpm check:rules` **Ran 83 of 83** · `pnpm lint` 0 errors · full `pnpm test` green ·
  `pnpm build` clean.

## Two spec mistakes, both found by the screenshot

1. **It pinned the wrong banner.** It drove through "Your day in review is ready" by clearing that
   day's dismissal key; the seeded account's waiting banner is the **weekly recap**. The failure read
   *"expanding did not reveal the banner"* while the screenshot showed the strip working perfectly.
   It now asserts on the container, not on one banner.
2. **`getByRole('button', { name: /ready/ })` matched a BANNER, not the strip** — "Your week in
   review is ready" contains the word. The control run against `main` therefore failed on the wrong
   assertion, which reads as a broken strip rather than an absent one. Pinned by test id.

## Also struck

**`LB-135`** — its job was exporting the lost 2026-09-22 mockup; that artefact is unrecoverable and
the redraw superseded it. The entry was already marked closed and said *"Strike this entry"*, and it
was still in the queue.

## Two findings that came out of CI while this was in progress

**`tn53`'s seed-state fix (#1925) holds on CI** — it is absent from the failures of the E2E run on
its own merge head, which is the confirmation that PR said it was still owed.

**That same run gave `LB-178` a third cause, and it is not in the specs at all.** It failed
`tn82-checkin-announce-and-correct`; the retained screenshot shows Home crashed to its error
boundary with *"Failed to load chunk … `exercise-detected-card` … (next/dynamic entry, async
loader)"*. The assertions never ran, and the spec reported *"the sheet never auto-opened"* — which
reads as a broken feature. `pnpm e2e` runs against `next dev`, which compiles on demand, so a
`next/dynamic` chunk request can fail while it is being built, on whichever spec happens to be on
Home at that moment. **That explains the churn the entry could not**: a failure that lands on
whatever is running produces a different flaky list every time.

**This change moves that dynamic import but does not alter it** — `ExerciseDetectedCard` is now
loaded from `home-banner-stack.tsx` instead of `session-select-content.tsx`, with the same
`dynamic(..., { ssr: false })`. Converting it to a static import is a real decision (the `ssr: false`
is deliberate), so it is recorded on `LB-178` rather than taken as a drive-by here.

## Not exercised

**Not device-verified, and the entry owes a device look explicitly** — the mockup's heights are
drawn to scale relative to one another, **not measured on a device**, and a real screenshot needs all
six banner conditions true at once, which no sandbox can arrange. The harness run had exactly **one**
of the four present, so the multi-icon strip and the four-banner expansion were **never rendered**;
the count logic is covered by the registry, not by a picture of it. No offline-first, native,
safe-area, gesture or notification surface is touched.
