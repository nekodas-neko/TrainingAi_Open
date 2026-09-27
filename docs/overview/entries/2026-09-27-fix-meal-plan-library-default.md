# 2026-09-27 — LB-159: the plan reuses your saved meals by default (v1.477.14)

**Branch:** `fix/meal-plan-library-default` · **Lane:** Implementation B · **Entry:** `LB-159` (removed from the queue).

## What shipped

`Use my saved meals` in the step-by-step plan setup now starts **on when the library has meals and
off when it does not** — the owner's answer of 2026-09-27, taken outright rather than as the
try-it-for-a-month variant. A plan built from meals already cooked carries real macros instead of an
estimate, and the generate route only fills the slots the library cannot, so variety is filled in
around the library rather than lost.

## The entry said "one line at `:81`", and that line would never have reached the screen

`LB-159` named `useLibrary`'s `useState` initial value. **That is not where the default is decided.**
The sheet's `open` effect resets the toggle on every open (`setUseLibrary(false)`), so an initial
value alone is dead code the moment the sheet is opened a second time — and it type-checks, reads
correctly in review, and changes nothing.

So the default is set in the `open` effect instead, from the library itself:

- **Seeded synchronously** from the `saved-meals` cache, so the first paint is right.
- **Corrected by a `cachedFetch`** on the same key and TTL `MyMealsPicker` uses, because the seed can
  be cold — the key is only warm once something has read it this session, and opening the sheet
  without first visiting the library would otherwise default OFF against a full library. That is the
  wrong answer arrived at silently, which is worse than the wrong answer arrived at loudly.
- **Guarded by a `touched` ref** so the correction can never overwrite a choice the user just made.
  Reaching the control takes several taps and the fetch lands long before that, so this is
  belt-and-braces — but an async response replacing a user's action is a bug class this project keeps
  re-finding, and the guard costs one ref.
- **`onError` keeps the seed** rather than forcing the toggle off: `off` is a claim that the library
  is empty, and a network failure is not evidence of that.

`check-cache-ttl-divergence` passes — one TTL expression for `saved-meals` across both call sites.

## The test, and what the control run proved

`e2e/lb159-library-default.spec.ts` pins both halves of the decision, because both halves *are* the
decision. Control-run twice, as this repo's rule requires:

1. **With the fix reverted**, the saved-meals case fails and the empty case still passes — the second
   is the old behaviour, so that is exactly right.
2. **With the entry's own suggestion** (`useState(true)` and nothing else), the saved-meals case
   **still fails**. That is the claim the spec's header makes, verified rather than asserted, and it
   is why the spec is worth its runtime: it is the only thing that can tell the plausible fix from
   the working one.

## Three things the harness cost, worth knowing

- **`click()` does not work on these screens and fails silently.** Five retried clicks over 90 s left
  zero dialogs open, while `dispatchEvent('click')` opened the sheet first time — and
  `elementFromPoint` at the button's centre returned the button itself, so nothing was covering it.
  This app's screens read raw touch events and these controls sit in a swipe carousel: `tapCentre`
  (the `Q-354` fixture) is the answer, and the failure mode reads exactly like a missing control.
- **A blind count of "Next" taps is wrong in both directions.** A touch dispatched mid-layout is lost,
  so four taps stop a step short; a loop that only watches the destination overshoots to step 6 where
  `Next` no longer exists. Each tap now waits for the step counter to advance, which is the one signal
  that says where you are.
- **A fixture that does not match the type crashes the screen, and it reads as a missing control.** A
  flat `calories` instead of `totals.calories` produced *"Cannot read properties of undefined"*, and
  the visible symptom was the toggle "not found".

## Not exercised

The APK. This is a client-only default on a sheet rendered in `next dev` under headless Chromium —
no safe-area, no gesture-nav clearance, no Samsung WebView, and no native SQLite. The behaviour has
no offline-first write path, so the device risk is presentational rather than about data; the two
cases are pinned by the spec at the 412 px project viewport.
