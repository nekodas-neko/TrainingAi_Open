# 2026-08-18 — Review sweep 38: offline read surfaces, driven for real

**Agent:** Review 📖 · **Branch:** `review/offline-read-surfaces` · **Docs-only.** Filed **Q-555** (low).

This role's baton had carried *"the offline and error paths"* as structurally untested since sweep 1.
Sweep 30 had just shown that a surface written off as unreachable dissolved in about a minute once
tried; `context.setOffline(true)` turned out to be the same kind of assumed barrier.

**The app works, and that is the headline.** Once the service worker controls the page, both offline
paths deliver. A full reload offline serves the precached `/offline` document verbatim — *"You're
offline… your saved data is still on the other tabs"* — and the precache succeeds even under
`next dev`. An offline tab tap navigates and paints **2515 characters against an online baseline of
2486, about 101%**, with no offline page, no skeleton and no blank. That is the instant-paint and
offline-first design doing exactly what the rulebook describes, and it is the strongest positive
result of this run.

**Q-555 is the narrow gap that finding exposed.** Every result above holds only while
`navigator.serviceWorker.controller` is non-null. In the uncontrolled state the same tab tap is a
**silent no-op** — URL unchanged, no navigation, no offline page, no feedback of any kind. And the
uncontrolled state is not exotic: it is the first-ever page load, because the worker registers
*during* that navigation and claims only afterwards. A genuine first session that loses connection
inside that window gets a tab bar where taps do nothing and nothing explains why. Filed at low
severity — it self-heals on the next load — but filed, because the symptom is indistinguishable from
a frozen app and because on the APK the service worker *is* the offline cold-start mechanism, so
install day is precisely when a new user is moving between networks.

**Method, and the reason this took five probe iterations: three produced plausible, specific, wrong
answers, every one publishable as written.**

The first concluded that no offline page is served on any surface — a clean table of zeros across two
pages and three network states. It was wrong because the reload happened while the worker was still
uncontrolled. **Registration is not control**: one registration was already present on the failing
load, and `controller` was the field that decided it.

The second reported that 38% of cached `/health` content survived offline. The offline body was 950
characters and the *home* page's own online size was 921 — the click had never navigated, so the
measurement was the home page against a `/health` baseline. **And the corroborating signal was wrong
in the same way**: the marker regex used `Sleep|Readiness` as evidence of the health surface, and the
home page renders widgets with exactly those labels. Two signals agreed and both failed for the same
reason. Only the URL — the one signal content overlap cannot fake — settled it. *Corroboration
between two weak signals is not evidence when they can fail for the same reason* is the sharper form
of the rule this run has been circling.

The third was subtler: the `controller` flag came back true after two loads in one run and false after
the identical sequence in the next. Activation races the navigation, so any probe assuming a fixed
number of loads is measuring a coin flip. The final version waits for the property instead of
assuming it.

**Not exercised, and the limit is load-bearing:** web build at the S25 viewport against the seeded
database. On web `cachedFetch` falls back to `localStorage`, so what was verified is the **seed**
path, not the native SQLite local store that is the actual source of truth on the APK. The
offline-first guarantee confirmed here is therefore the weaker, web half — and Q-555's first-load
window especially should be re-checked on device, where the worker's install timing and the WebView
lifecycle differ.
