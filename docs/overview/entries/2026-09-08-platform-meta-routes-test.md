# 2026-09-08 — how the app reports and delivers itself (PS-39, 54 → 50)

**Branch:** `test/platform-meta-routes` · **No product change.**

16 cases over `version`, `status`, `download-apk` and `export` — the four routes an owner reaches
for when something is already wrong, which is the worst possible moment for one of them to be
subtly untrue.

## What the cases decide

- **`version` and `nativeVersion` are different things.** The APK loads its UI from Railway, so
  nearly every release reaches the device with no reinstall; comparing against the web version told
  the owner to reinstall for changes they already had, every release. The two fixture versions are
  deliberately unequal — equal ones would let the route read either source for either field and
  still answer correctly.
- **`null` means "could not check", never "up to date"** — which is why `nativeVersionStatus`
  exists, and why the test asserts `unconfigured` and `unavailable` separately.
- **`version` is the one sanctioned `Cache-Control: public` route.** `check-api-no-store.js` exempts
  it by name; the test proves the exemption is load-bearing rather than an allowlist entry
  protecting nothing.
- **`status` leaks nothing.** It is unauthenticated by design, so the failure case asserts that a
  driver error carrying a host and a password reaches the response in no form at all — checked
  against each substring, not by eyeballing the shape.
- **`status` gives up on a hanging database** rather than hanging with it: the race is what turns an
  unbounded wait into a diagnosis. Verified with fake timers at the 3-second boundary.
- **`status` keys its rate limit on the hop nearest us** (Q-493). The leftmost `x-forwarded-for`
  entry is caller-supplied, so keying on it lets a caller rotate its own bucket — measured at 30
  keys of count 1 against a limit of 20. The forgeable and real addresses in the fixture differ, so
  the assertion can tell which was used.
- **`download-apk` separates 502 "could not check" from 404 "no APK in the release"** — the same
  distinction `version` draws with its status field. One code for both hides a broken integration
  behind a plausible answer.
- **`export`'s filename carries the USER's date**, and its rate limit is two per **hour** — a copied
  `60_000` from a sibling route would be a 60× loosening that no status code reveals, so the window
  is asserted literally.

## A finding, pinned rather than fixed — LA-84

`exportUserData` is an async generator and the route enqueues lines as they arrive, so **the headers
are already sent by the time it can throw**. The `catch` cannot change the status: it logs and
closes. The user gets a 200, an attachment filename, and a file that ends wherever the failure
happened, with nothing in it saying so — on the one feature whose entire purpose is being a complete
copy.

The test asserts the current behaviour and says outright that it is doing so. Not fixed here because
the remedy is a format decision: a trailer that mirrors the manifest (`{"_complete": true}`) makes
truncation detectable by *absence*, which also catches a file cut off by a dropped connection — but
it changes the contract for every consumer. Filed as **LA-84** with that reasoning, and the entry
carries a `Keep:` line noting the test will need inverting when it ships.

## Mutation pass

**16 of 17 caught.** The survivor is an equivalent mutant planted as a control — a no-op type
annotation — so the loop is shown to distinguish a real change from a cosmetic one rather than
merely reporting a perfect score.

## Not exercised

Every dependency is mocked: no database, no GitHub release lookup, no real export. The 3-second
timeout is exercised with fake timers, not a genuinely slow query. Web/Node only — no device, no
native, safe-area, gesture or notification surface.
