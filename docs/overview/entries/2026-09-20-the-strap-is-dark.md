# The strap is dark, and nothing says so

**Tuning agent · 2026-09-20 · branch `tuning/tn54-strap-silent-with-no-trace` · docs-only**

The owner wore the chest strap overnight and asked whether it captured what PS-44 needs. It did not —
and the finding is that neither of us could tell why.

## What the data says

Across `rr_intervals` **and** `oura_heartrate`, the last chest-strap sample of any kind is
**2026-09-15 23:11 UTC — 09:11 Brisbane on the 16th.** Five days, both tables, zero rows.

**The ingest path is healthy.** The same night the ring wrote **455 HR samples, 104 of them in core
sleep**. Phone, app, network and `/api/hr-ingest` all worked. Only the strap contributed nothing.

## The gap worth fixing

| | ring | chest strap |
|---|---:|---|
| battery readings persisted | **11,758** (today, 76%) | **0 — memory only** |
| connection/status rows | present | **none** |
| faults in `error_events` (48 h) | — | **none** |

`PolarStrapService` keeps `battery` in a `private var` written once per connection and never sent
anywhere. Its give-up path — `stopSelf()` after six consecutive failures, logged as *"giving up …
strap not reachable"* — reaches `onLog` and no table. **A strap that is flat, unreachable, or whose
service quietly stopped looks identical to a strap that was not worn**, from every surface except
opening the app while it is failing.

PS-44 needs seven paired nights and its own guard says not to count a night until it is in the table.
Without a status signal the owner cannot know in the morning whether last night counted. Managed that
way, a seven-night window takes far longer than seven nights — it has already cost one.

## Filed as TN-54

Persist what the ring already persists: a status row per connection attempt with battery, state and
`last_sample_at`, on the native HTTP path that already posts samples. `oura_ble_battery_poll` is the
shape to copy, so this is not new infrastructure.

**Deliberately not diagnosed.** A flat CR2025 (141,745 RR intervals of use, and Polar's own notes say
a dying cell presents as flaky connections), a service that gave up and was never restarted, and
Bluetooth being off are all consistent with what is stored. The entry is about not being able to tell
which, and says so rather than guessing.

**And not solved by a notification.** A low-battery channel already exists in the service and did not
prevent five silent days. A notification is not a record, and *"did last night count"* is asked the
next morning.

## Diagnosed live, an hour later

The owner replied with a screenshot of the Devices screen reading **"Polar H10 · Connected · on your
chest"** — and rows began arriving in the same minute, 06:03 Brisbane. Consecutive stored RR rows:

| Brisbane | rr_ms | gap |
|---|---:|---:|
| 06:03:28 | 802 | — |
| 06:03:58 | 1247 | **30.2 s** |
| 06:04:29 | 715 | **30.2 s** |
| 06:04:59 | 790 | **30.7 s** |

**Opening the app is what started it.** Not the cell, not the link, not the ingest path — the service
was not running, and nothing restarts it until the app is launched. Its own give-up path
(`stopSelf()` after six failures) is the likely cause.

That makes the observability gap the whole bug. The Devices card showed **"Connected"** with no
battery figure while the ring beside it showed 75% — so the one surface checked actively reassured
him. The revised ask is smaller and sharper: surface **last-sample-at**, which the app already has.
"Connected" is not the useful fact; *"last sample 5 days ago"* is.

**And it confirmed TN-51 is worse than estimated.** 30-second gaps with **one** RR interval per kept
sample, not the islands of 2–3 inferred from history. With one interval per island there are no
adjacent pairs, so rMSSD is not degraded — it is **undefined**.

## The battery indicator: do not build what was asked for

The owner wants an accurate strap battery reading because Home shows a constant 100%. **That is the
cell behaving normally.** The H10 runs a CR2025 — a primary lithium coin cell with a near-flat
discharge curve — and `PolarStrapService` already carries the comment *"a dying cell presents as
flaky connections long before it presents as a dead strap."* A truer percentage is not available
from this chemistry, and an APK cycle spent on it buys a number that still cannot warn.

**`last_sample_at` and connection reliability move days before the percentage does.** That is what
belongs on the card.

## And the indicator he needed already exists, hidden

The service runs a foreground notification reading **"Connected · N% battery"**, **"Strap unreachable
— retrying in Ns"**, or nothing at all when it is not running. Its channel is **`IMPORTANCE_MIN`**,
so Android collapses it into the silent section with no status-bar icon.

**That is a check that works today:** expand the silent section of the shade and look for *"Chest
strap"*. Absent means the service is down and no night will record. Raising the importance wholesale
would be wrong — `MIN` is right for an all-day service — so the entry asks for it only during a
declared sleep session, or mirrored into the app.

## What was not exercised

Stored production reads plus a source read, in the sandbox. No code changed, no device, no APK, no UI.
The strap's battery state is unreadable from here by construction — that is the finding, not a
limitation of the check.
