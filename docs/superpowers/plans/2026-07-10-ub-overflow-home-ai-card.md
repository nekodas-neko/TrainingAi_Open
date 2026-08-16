# UB-overflow — Home AI daily/weekly update card overflows the viewport

**Source:** `docs/reviews/2026-07-09-user-reported-bugs.md` (UB-overflow, issue 2), grounded
against `main`@`6264f16`. **Branch:** `fix/ai-card-overflow`. Client + CSS only — a
`Response`-component class change, one `globals.css` rule, and two container class strings.
Ships via Railway into the WebView, **no APK rebuild**. The ≤640px overflow is verifiable in
the dev server at a narrow viewport (Playwright) and on the S25 device.

**Goal:** stop long AI markdown (unbreakable tokens / KaTeX display math) from pushing the home
daily and weekly AI update cards wider than the screen and enabling horizontal scroll.

**Shipped (v1.124.8, 2026-07-10, session 255).** Both chunks landed exactly as specified: the
`Response` root gained `min-w-0 break-words [overflow-wrap:anywhere]`, `globals.css` gained the
`.katex-display` overflow-x rule (the `body { overflow-x: hidden }` guard this was meant to sit
next to already existed on `main`, so only the katex rule was new), and both container class
strings (`session-select-content.tsx`'s `scrollClassName`, `day-review-sheet.tsx`'s
`SheetContent`) gained `overflow-x-hidden`. `pnpm lint`/`tsc`/tests/build all green. **Not
exercised:** no Playwright/browser automation available in this sandbox, so the ≤360px viewport
verification prescribed above was not run interactively — the fix was verified by reading the
exact diff against the plan's prescribed classes/rules rather than visually. On-device (S25 APK)
remains the authoritative WebView check per the plan's own note.

This directly serves the CLAUDE.md rule: *"Wide content (tables, diagrams, code blocks) must
scroll inside its own `overflow-x: auto` container — the page body must never scroll
horizontally."* Tables (`response.tsx:250`) and code blocks (`code-block.tsx`) already obey it;
plain paragraph text and KaTeX display blocks do not, and the home scroll container does not
contain the escape.

---

## Chunk 1 — Root cause: wrap AI markdown text + tame KaTeX display math

Both AI cards render through `components/ai/response.tsx` (`day-review-sheet.tsx:62` and
`weekly-recap-banner.tsx:100` both `dynamic`-import `Response`), so fixing the shared component
fixes every `<Response>` call site at once.

1. **`components/ai/response.tsx:369-373`** — the `Response` root `<div>` currently sets `w-full`
   but nothing that lets long tokens break. Current:
   ```tsx
   <div
     className={cn(
       "w-full [&>*:first-child]:mt-0 [&>*:last-child]:mt-0",
       className,
     )}
     {...props}
   >
   ```
   (exact current first class string: `"w-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0"`.)
   Add `min-w-0`, `break-words`, and `[overflow-wrap:anywhere]` so an unbreakable token wraps
   instead of forcing width:
   ```tsx
   <div
     className={cn(
       "w-full min-w-0 break-words [overflow-wrap:anywhere] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
       className,
     )}
     {...props}
   >
   ```
   `min-w-0` is required because the card is a flex child — without it the min-content width of a
   long token still overflows even with `break-words` on the text.

2. **`app/globals.css`** — there is currently **no** `katex` / `break-word` / `overflow-wrap` /
   `word-break` rule anywhere in the file (confirmed by grep). KaTeX `.katex-display` renders as a
   non-wrapping block and is the other way content exceeds the viewport. Add, next to the existing
   overflow guard at `globals.css:303-306`:
   ```css
   /* Prevent horizontal overflow/scroll on any screen */
   body {
     overflow-x: hidden;
   }

   /* KaTeX display math can't wrap — let a long equation scroll inside its own
      box instead of widening the AI markdown card past the viewport. */
   .katex-display {
     overflow-x: auto;
     overflow-y: hidden;
     max-width: 100%;
   }
   ```
   This mirrors the table/code-block pattern (wide content scrolls inside its own
   `overflow-x: auto` box) rather than pushing the page.

**Verify:** in `pnpm dev`, open the home screen at a 360px viewport (Samsung S25 width) and open
the daily "Your Day in Review" sheet and expand the weekly recap. Feed a digest containing a very
long unbroken token (e.g. a 60-char word/URL) and a `$$…$$` display equation. Confirm the card
text wraps within the card and no horizontal scroll appears on the page. Playwright:
`page.setViewportSize({ width: 360, height: 800 })` then assert
`document.scrollingElement.scrollWidth <= innerWidth + 1` and the same for the card's scroll
container.

## Chunk 2 — Belt-and-braces: contain overflow at the two scroll containers

Cheap containment so any *future* wide child can't re-open horizontal scroll on these surfaces.
`body { overflow-x: hidden }` does not help here because the offending scroller is an inner
element: an element with `overflow-y: auto` and default `overflow-x: visible` computes `overflow-x`
to `auto` per CSS, so it scrolls horizontally on its own.

1. **`app/session-select/session-select-content.tsx:955`** — the home `PullToSync` scroll area
   (rendered at `pull-to-sync.tsx:190` as `<div ref={scrollRef} className={scrollClassName}>`).
   Current:
   ```tsx
   scrollClassName="flex-1 overflow-y-auto pb-nav-safe"
   ```
   →
   ```tsx
   scrollClassName="flex-1 overflow-y-auto overflow-x-hidden pb-nav-safe"
   ```

2. **`components/day-review-sheet.tsx:56`** — the daily card's bottom sheet. Current:
   ```tsx
   <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
   ```
   →
   ```tsx
   <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto overflow-x-hidden">
   ```

No change needed for the weekly inline card: `weekly-recap-banner.tsx:71`'s wrapper already carries
`overflow-hidden`, so it clips on its own — leave it as-is.

**Verify:** same 360px viewport pass as Chunk 1, plus resize down to ≤360px and drag the page
horizontally — no scroll/rubber-band on the home list or the daily sheet. On-device (S25 APK) is
the authoritative check for WebView, since the dev sandbox renders safe-area/WebView quirks
differently; confirm no horizontal drift on a real long AI update.

---

## Notes vs current code

- Finding is accurate. `response.tsx:369` root has `w-full` and **no** break/min-w-0 utilities;
  `globals.css` has **no** katex/break rules (grep clean); `session-select-content.tsx:955`
  `scrollClassName` is exactly `"flex-1 overflow-y-auto pb-nav-safe"`.
- Minor correction: `day-review-sheet.tsx` lives at `components/day-review-sheet.tsx` (not
  `components/.../day-review-sheet.tsx`), and its `SheetContent` className is
  `"max-h-[85vh] overflow-y-auto"` (the finding said "only `overflow-y-auto`" — the `max-h-[85vh]`
  is also present but irrelevant to the fix).
- `weekly-recap-banner.tsx:71` confirmed to already clip via `overflow-hidden` — correctly excluded
  from the fix.
