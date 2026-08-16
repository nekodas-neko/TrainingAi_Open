## 2026-07-28 — Native-feel Phase 2: serve documents and RSC payloads stale-while-revalidate

Implements [`docs/superpowers/plans/2026-07-28-native-feel-phase-2-instant-navigation.md`](../../superpowers/plans/2026-07-28-native-feel-phase-2-instant-navigation.md)
(backlog Q-1, Phase 2), from issue #868. Phase 1 shipped in #877.

### Change

`public/sw-template.js` — two fetch branches move from network-first to stale-while-revalidate, plus
a helper that bounds which cache generations may answer:

- **Top-level navigations** (cold start, hard reload, notification tap) now serve the cached document
  immediately and revalidate in the background. Previously every cold start waited a full round trip
  to Singapore before it could paint.
- **RSC payloads** (`GET` with a `_rsc` query param) get the same treatment. This is the branch that
  actually governs non-tab screen changes — see the finding below.
- **`matchLiveCaches()`** restricts document lookups to the current generation and the one `activate`
  retains as `prev`. A plain `caches.match()` searches every cache still on disk, which could serve a
  document whose `_next/static` chunks were already deleted — the one genuinely unsafe case. It is now
  excluded structurally rather than left to Next's mismatch handling alone.
- **App icons are cache-first.** `/favicon.ico` is 26 kB and matched no cache rule, so it fell through
  to the network-first branch and was re-downloaded on every screen change. The owner's device capture
  measured it at **338 ms – 1.43 s, twice per screen** — the slowest recurring request in the app, and
  on some screens the slowest request full stop. The content-hashed `/icon` route beside it was already
  fast because it matched the `_next/static` rule.

`AUTH_PAGES` (`/sign-in`, `/pending`, `/register`) stay excluded — a cached sign-in page would serve a
stale CSRF token. The `_rsc` branch is `GET`-only so Server Action POSTs are never served from cache.

### The finding that shaped this

**Non-tab routes are entered by `router.push` (39 call sites), not document loads.** They therefore
fetch RSC payloads, and the service worker's `navigate` branch never sees them. Fixing only that
branch — which is how this work was originally framed, and what the prior investigation implied —
would have sped up cold start and nothing else. Both branches had to change.

### Tests

`node --check public/sw-template.js` clean. `pnpm tsc --noEmit` clean, `pnpm lint` 0 errors.

Measured as a paired A/B in Chromium against `pnpm dev` — same harness, same server, only the worker
differing — timing a warm navigation with the service worker in control:

| Service worker | Runs | Navigation to DOM |
|---|---|---|
| `main` (network-first) | 3 | 376 / 335 / 320 ms |
| This change (SWR) | 2 | 32 / 36 ms |

**Correction to an earlier claim in this work:** a first version of the harness injected 2 s of CDP
latency and reported the change "won the race against 2000 ms". That was wrong — running the same
harness against `main`'s worker also passed, which proved the injected latency never reached the
service worker's own `fetch`. The threshold was meaningless and the result is withdrawn. The A/B
above replaces it: it holds the environment fixed and varies only the worker, so the ~10× difference
is attributable to the change. The absolute numbers reflect dev-mode localhost, not Brisbane→Singapore.

### Not verified — and one of these is a correctness gate

- **The deployment-skew case.** Does a cached document survive a new Railway deploy, or break? This
  needs a real deploy against a phone with an already-activated worker and **cannot** be reproduced in
  the sandbox. Per the plan, this is a correctness gate, not a polish check: if the app fails to load
  rather than self-healing with one reload, this change should be reverted, not shipped behind a
  caveat. **The PR is deliberately held unmerged pending this.**
- **Push notifications under the new worker.** The `push`/`notificationclick` handlers are untouched,
  but the service worker is the push transport and that path was not exercised.
- **On-device cold start.** The entire point of the change; unmeasured until the device run.
