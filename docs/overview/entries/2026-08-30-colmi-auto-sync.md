# 2026-08-30 — the ring syncs itself, because the rule did not hold

Branch `feat/colmi-auto-sync`

## Why

The ring answers HRV, stress, SpO₂ and temperature for the **current day only** — those commands
take no date, unlike heart rate and activity, which are addressed by day and therefore back-fill on
a later sync. A day whose evening is never synced loses those four permanently: the ring overwrites
them, and `colmi_raw_frames` cannot help because those bytes were never sent.

It happened on 2026-08-28 (stress stops at 06:30) and again on 2026-08-29 (17:30) — **the second
time after the owner had been told the rule**. A correctness property that depends on a human
remembering a protocol quirk is not a property; the owner's response was "I'd rather we just make it
auto sync then rather than dependant on me", which is right.

## What it does

`useColmiAutoSync` is mounted in `TabShell`, which never unmounts — so this is *the app being
open*, not a screen being visited. It attempts a sync on mount, on every return to visibility, and
every 30 minutes, each attempt gated by `shouldAutoSync` against a timestamp in `localStorage`.

Four decisions worth keeping:

- **A failed sync still marks the time.** The ring sleeps its radio when worn-idle and answers
  nothing, which is normal rather than an error. Retrying against a sleeping ring would drain the
  phone and the ring both.
- **`shouldAutoSync` returns true when the stored time is in the FUTURE.** A timezone change or an
  NTP correction moves the clock backwards; treating that as "too soon" would silently stop syncing
  for as long as the skew lasted — the exact failure this exists to prevent.
- **A module-scope in-flight flag, shared with the manual button.** A BLE peripheral takes one
  connection, and a second attempt reads as "ring not found" — which the owner had already reported
  after the scale held the radio. Sync now refuses with a plain message instead of colliding.
- **A 4-second delay after resume.** The WebView is still settling the radio right after a resume,
  and a connect issued into that window fails in the way that looks like an absent ring.

`nowPartsInTz` moved from `colmi-pairing.tsx` into `resolve-time.ts` — two callers now build the
ring's clock argument, and two copies of a clock helper is how they drift.

## The isolation guard earned its place

`check-learning-mode-isolation.js` failed on this diff, because the shell now reaches a
learning-mode module. That is the check working: it forced the widening to be written down rather
than absorbed. The hook is allowlisted with the reason — it **triggers** a sync and reads nothing,
and the property protected is that no scoring input is fed from the ring, which a caller that only
starts an ingest cannot breach.

## Verified, and not

Verified: 75 Colmi tests including 7 new ones over the interval decision, the future-clock case, the
failure path and the in-flight guard; `pnpm check:rules` 61 of 61.

**Not verified: the hook running on the device.** BLE does not exist in the sandbox, so the timer,
the visibility listener and the resume delay are exercised by nothing. The check is one evening
where the owner does not press Sync and the day's stress still reaches the database.

**Unrelated pre-existing failure:** `batch-upsert-duplicate-collapse.test.ts` fails locally with
this branch stashed too. Left to CI, which runs on a clean database.
