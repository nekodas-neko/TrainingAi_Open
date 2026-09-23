# 2026-09-23 — The probe tooling, built and self-tested while the phone was unplugged

**Branch:** `device/probe-tooling` · **Agent:** Device Verification · **`scripts/device/**` + docs.**

The owner asked what was waiting. Nothing was assigned in `Lane: DV`, but **111 device checks are
owed** (`--sittings`) and Review had filed **RV-124…RV-133** with a full method doc,
`docs/device-agent-probe-checklist.md` (P1–P10). Most of those probes need the network layer, the
local store, offline switching or long-session counters — none of which the harness had. So this
session built them, with the phone unplugged, and the owner approved all five write types the
write-based probes need (each deleted straight after).

## What was built

- **`pw.js`** — Playwright's `connectOverCDP` on the WebView socket, as the probes' driver. `tap`
  keeps the hit-test-before-touch rule and drops the centring that pinned BF-100's first
  measurement. Adds `recordNetwork` (over CDP, for initiator stacks), `recordConsole`,
  `watchAfter` (P1), `offline` (P8), `metrics` + `instrumentTimersAndReload` (P10), and a
  read-only `localQuery` against the app's own SQLite (P3).
- **`sweep.js`** — P4: bottom clearance against the real inset, horizontal overflow, sub-44px
  targets, `truncate` on flex, nested interactives. Reads the nav mode and refuses to vouch for
  clearance off gesture nav.
- **`census.js`** — P2, P7 and P10 in one tab walk: per-endpoint request counts by visit, every
  non-2xx and console message grouped, heap/listener/timer counts at start, end and after idle.
- **`selftest.js`** — all of the above against a local fixture in desktop Chrome, through the same
  `connectOverCDP` path. **18 of 18 pass.**

## The e2e question, answered

The owner asked whether running `e2e/**` on the phone was worth it. **Not as it stands**: 62 of
121 specs read or write the local test database, ~80 assume the seeded account, and the suite signs
in — which on the phone means signing the owner out, and sign-out wipes the device's local data.
What *is* worth it is Playwright as this role's driver, which is what `pw.js` is. A small
read-only phone regression pack stays optional, after the probes.

## Not exercised

Everything on the phone: none of `pw.js`, `sweep.js` or `census.js` has run against the WebView.
`localQuery` has only been seen refusing a write and reporting a missing plugin; whether the
plugin answers a query on the app's open connection is unknown. Whether `offline(true)` reaches the
service worker's requests on this WebView is unknown.
