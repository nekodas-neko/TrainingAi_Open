# 2026-08-02 — the raw-store runbook checks are now performable (Q-33)

**Branch:** `feat/admin-raw-stats-card` · **Version:** 1.250.5 · Run-list item 9 of the
[batch queue drain](../../handoff-2026-08-02-platform-batch-queue-drain.md).

## What was wrong

`lib/oura-ble/plugin.ts` has exposed `rawStats()` on the native bridge since the on-device raw store
shipped, and nothing rendered it. So §4 of
[`docs/oura-ble-operations.md`](../../oura-ble-operations.md) — steps 3b and Task-3-confirm —
documented retention checks the shipped admin console could not actually perform. The runbook was
writing cheques the UI could not cash.

## What shipped

A **Raw store** card at the top of the Oura BLE admin page (directly under the debug panel, since
it is status rather than a probe): total rows, rolled-up, unrolled, bytes on disk, and the low-disk
flag.

It is native-only by construction — `getOuraBle()` returns null in a browser — so the web build
says so plainly instead of rendering zeros that would read as real measurements. That distinction
matters here: a card showing `0 rows` on a laptop is worse than no card, because the runbook's
whole purpose is deciding whether retention is working.

## Verified

- Admin page returns 200 and the card's heading, copy and button are in the rendered HTML.
- Clicked headless at 412px: the button fires and the card reports *"Not available in the browser —
  the raw store lives in the native service. Open this on the device."* No page errors.
- Full suite green, lint and typecheck clean, custom rules pass.

## Not exercised

**The actual `rawStats()` numbers have never been read.** That call only exists in the native
service, so the populated state of this card — the one the runbook needs — has not been seen. It
ships through Railway (no APK needed) and is on the owner device checklist. Reading it once also
answers the retention question §4 exists to ask, so the check is worth doing on its own merits, not
just to verify this card.
