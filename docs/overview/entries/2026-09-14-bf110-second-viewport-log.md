# 2026-09-14 — a second look at the resume viewport, before any fix (BF-110)

**Branch:** `feat/bf110-second-viewport-log` · **Lane B** · instrumentation only, no version bump

## The state of the evidence

`error_events` now holds seven days of `bf110 resume dom-intact` breadcrumbs, and they separate
**perfectly** on viewport height — across six different routes, with the same route appearing on both
sides:

| viewport | DOM children | reading |
|---|---|---|
| **667** | 1–2 | blank |
| **826** | 7–8 | rendered |

The S25's real CSS viewport is **826**. **384×667 is the classic default a WebView falls back to
before it has been told the real size.** So the shape is not *"the renderer died and painted
nothing"* — it is *"the WebView resumed at a fallback viewport and the app rendered almost nothing
into it"*. Cheaper to test, and a different bug.

## What the data cannot separate, and why that matters

A viewport genuinely **stuck** at the fallback, versus a breadcrumb that simply fired **before** the
WebView resized. Same 667 either way.

**Those two answers point at different files** — one is the native layer, the other is when the app
decides to render — which is why the entry insists nothing be fixed until the reading exists.

## What shipped

`handleResume` reads the shell box again **500 ms into the same resume** and files
`bf110 resume recheck stuck|resized h1=… h2=… w2=… children2=…`.

Three decisions worth keeping:

- **It re-reads the element**, rather than closing over the first sample for both halves. That
  mistake produces a row that always says `stuck` and looks like an answer. There is a test that
  fails on exactly that shape.
- **It rides the first row's budget.** The recheck fires only when the first sample was worth
  filing, so a reported resume costs two rows and an unreported one costs none. `error_events`
  prunes at 30 days and is the second-largest object in the database; a recheck on every resume
  would double the cost the once-per-launch cap exists to avoid.
- **The verdict is a word, not two numbers.** Whoever reads that table will be looking for `stuck`
  or `resized`, not diffing heights.

`defer` is an optional parameter so the first half's call and tests are untouched — which makes it
exactly the kind of thing that can be added and never passed, so a test asserts the real
`setTimeout` is wired at the call site.

## Verification

17 tests in `lib/__tests__/bf-110-resume-repaint.test.ts`, up from 12. **The two load-bearing ones
were falsified, not assumed:**

| Break I introduced | Which test caught it |
|---|---|
| report the first sample twice instead of re-reading | *reads the element AGAIN…* |
| schedule the recheck outside the row budget | *rides the first row budget…* |

`pnpm check:rules` **Ran 74 of 74** · `npx tsc --noEmit` clean · `pnpm lint` 0 errors (two
pre-existing Lane A warnings) · `vitest run lib/` **4697 passed**.

## The entry was parked on a gate that was wrong

The Orchestrator removed it the same day, and the reasoning is worth carrying: `Gate: device` parked
the whole entry, but **the next step needs no device at all** — a log line in the shell, shippable
here. What needs the device is the verdict on a *fix*, which is a `Verify:` after something ships.
**The owner sat on this item twice in device passes with nothing he could usefully do**, because the
question was never his.

That is the **fifth** instance this session of a field's job being done in prose — and the second
found by someone else. Here a gate scoped by prose to one paragraph parked an entry whose other
paragraph was ready to build, and `next-item.js` cannot see the scoping.

## What was NOT done

- **No fix.** Deliberately, and the entry is emphatic: the two possible readings point at different
  files, so writing a fix now means picking one at random.
- **Not seen on the device.** The 500 ms window is the entry's number, not a measured one. If the
  readings come back ambiguous that is a finding about the window, not a licence to keep raising it.
- **The recheck has never fired against a real blank resume** — only against fixtures. It is
  scheduled on a resume that files a row, and whether the owner's next blank resume is one of those
  is not something the sandbox can establish.
