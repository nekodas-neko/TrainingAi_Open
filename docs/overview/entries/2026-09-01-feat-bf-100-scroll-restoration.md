# 2026-09-01 — BF-100: back navigation returns to where you were

**Branch:** `feat/bf-100-scroll-restoration` · **Domain:** `app-shell` · **Lane:** B · **Version:** v1.424.0

Owner: *"when I scroll down to a button; then click on it and it takes me to a new page; when I press
back I want to go back to that page at the same scroll level I was at. It usually starts me at the
top of the page. This is on many pages if not all pages."*

## One cause, all pages

The app does not scroll the document — it scrolls an inner container. Next's App Router scroll
restoration operates on the window scroller, so it cannot see, save or restore a nested element's
`scrollTop`, and nothing in the app did it either. Measured before building: `/health` reads 600 on
its container after scrolling, the document reads 0 throughout, and a push-and-back returns 0.

So `lib/hooks/use-scroll-restoration.ts`, called once from `pull-to-sync.tsx` — every screen using
the shell inherits it, rather than 62 separate fixes.

**A tab-to-tab move was never affected**, which took a retraction to establish: the shell keeps every
tab screen mounted, so the container holds its own offset unaided. Measured, with Health's container
still reading 840 while the URL was `/nutrition`.

## Six traps in the implementation, none visible by reading

Every one produced code that runs, does what it says, and achieves nothing:

1. **A `popstate` flag to tell back from forward** — StrictMode's double-invoked effect consumes it
   on the first pass, so the surviving pass always sees `false`. Removed entirely: clearing the entry
   as it is restored gets the same outcome, because a fresh arrival has nothing saved.
2. **Reading `el.scrollTop` in the cleanup saves 0** — React has already detached the node, and a
   detached element reports 0. Tracked from a `scroll` listener instead.
3. **Setting the offset once lands 144–231 px past it** — content keeps arriving above and the
   browser's scroll anchoring pushes the offset down. Re-asserted for the window.
4. **Judging user takeover by comparing the offset to what we set** treats that same settling as a
   finger, so it yielded every time and the re-assert never held. Takeover is an **input event**
   (`wheel`/`touchstart`/`keydown`).
5. **Consuming the saved value on read** — StrictMode again, in a different shape. Pass one takes it,
   finds the container too short, waits; pass one's *cleanup* writes 0 over the pending target; pass
   two reads 0 and discards it. The trace that caught it:
   ```
   [SR] mount /more target 1051 gap 766   <- pass 1 takes 1051, waits for growth
   [SR] save  /more 0                     <- pass 1's cleanup overwrites it
   [SR] mount /more target null gap 766   <- pass 2 finds nothing
   ```
   Read without consuming, clear when the restore lands, never write 0 over an unlanded target.
6. **A screen can come back shorter than it was**, so abandoning the restore drops the user at the
   top — the bug. The window now lands at `min(target, available)`.

**The restore window was not the cause, though it looked like it twice.** Raised to 120 s as a
controlled experiment and the run stayed red, which is what forced the instrumented run that found
(5). The wider value is kept on its own merits; the timer was never the safety mechanism — takeover is.

## Four traps in the spec, which cost more

`e2e/scroll-restoration.spec.ts` took four attempts, and **all four failures reported
`expected 840, received 0`** — indistinguishable, from the summary line, from a broken feature:

- text-matching *Sleep* hits a card that opens a **sheet**, so nothing unmounted;
- `Sleep details →` does the same;
- `a[href^="/health/"]` matches nothing, because these screens navigate from `router.push` buttons;
- driving the push through the bottom nav makes `page.goBack()` land on **`about:blank`**.

`/more` → *Profile details* → back is the verified path. The spec asserts its own preconditions — that
the push navigated, and that something was saved — which is what tells a fixture problem from a
regression, and is why the third and fourth rounds took minutes rather than an hour.

## Verified

`e2e/scroll-restoration.spec.ts` **4 passed** against a cold harness server, and manually against a
warm one: `/more` scrolled to 840 → push → `ta_scroll:/more = 840` → back → **840, exactly**. A fresh
forward arrival still starts at the top.

## Not exercised

- **The S25.** The system back gesture is not the same input as `page.goBack()`, and the WebView's
  scroll anchoring may differ from desktop Chromium's — which matters, because trap (3) was anchoring.
  BF-100 stays queued on `Verify: device`.
- Home (`session-select`) uses the same shell and inherits this, but was not the screen measured.
