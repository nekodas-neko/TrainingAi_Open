# BF-195 — the app handles offline and hangs on barely-online

**Branch:** `docs/bf-195-low-reception-hangs` · docs-only · BugFix intake

Owner: *"I went to an area with low reception and nothing really worked on the app. It should still
have most functionality."* Five screenshots, all tabs, all showing the offline banner.

**Connectivity is modelled as a boolean and the failing state is a third one.** `useOnlineStatus` is
`navigator.onLine` plus Capacitor's `networkStatusChange.connected`. Both report true whenever the
radio is attached. Low reception is *online with no throughput*, and the app has no state for it —
so the offline branch of `cachedFetchCore`, which explicitly paints saved data, never runs.

**There is no fetch timeout anywhere in the client data layer.** Grepped `lib/sqlite/`,
`lib/hooks/`, `lib/local-store/` for `AbortController` and `AbortSignal.timeout`: zero matches. A
request issued on a dying connection hangs, and nothing converts hanging into a rendered state.

`session-select-content.tsx:1036` gates its skeleton on `refreshing`, which never clears. The
in-flight map compounds it — a second caller joins the hanging request rather than firing its own.

The screenshots split three ways, and the split is the evidence:

| surface | behaviour | why |
|---|---|---|
| Health → Body | **worked** (RHR 55, HRV 54, SpO₂ 93.5) | painted from `readCacheSync` seeds |
| AI Periodization, muscle volume, trends | skeletons forever | gated on a fetch that never settles |
| Workout session list, September calendar | blank | seed empty *and* `refreshing` stuck |

The Body tab working is the important half: the offline-first architecture is sound where it was
applied, and what fails is the layer above it.

Two things the entry insists on. The banner currently reads *"Offline — showing saved data"* over
screens showing none — a false promise regardless of what else is fixed. And **a gym is the
canonical low-reception location for this app**, so the session list is the one screen that must
work on bad signal and the one rendering nothing.

Recommended fix, filed `Lane: A`: a timeout on the fetch in `cachedFetchCore`, so hanging collapses
into the failure path that already exists and handles it correctly. One call site, every screen.
Plus deriving `online` from whether requests complete rather than whether the radio is attached.
Explicitly **not** recommended: adding seeds to the three blank surfaces, which would paper over
three instances and leave the next screen to rediscover the hang.

**Separately observed and deliberately not diagnosed:** the sleep card read "Last: 2026-08-25", a
month stale, on a day production holds sleep through 09-24 — and `sleep-sessions` is warmed at every
app open. A screenshot cannot distinguish a stale cache entry from the card's own fallback, so the
entry says to read the device's cache before folding it into BF-195.

Verification is network throttling, not airplane mode — airplane mode exercises the path that
already works.
