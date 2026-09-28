# Device sitting plan — 2026-09-28

Written by the Orchestrator for the Device Verification agent. It is a **reading of
`node scripts/next-item.js --sittings`**, not a replacement for it: regenerate that output at the
start of a sitting, because the queue moves.

**This is a plan, not an assignment.** Per `CLAUDE.md` a `Batch:` field is written when an entry is
next touched, never in a bulk sweep, so nothing here has been stamped onto the entries themselves.

Baton: [`docs/agents/state/device-verification.md`](agents/state/device-verification.md).

**126 device checks are owed** across the queue, plus **10 entries fully BLOCKED** until the phone
answers. That is far more than one sitting, so it is split into five below, **ordered so the ones
most likely to FAIL come first** — per `CLAUDE.md`, that ordering is what makes the 45–60 minute
sitting pay, because a failure found at minute 5 goes to a lane while the rest of the sitting runs.

**Take them in order. Do not start a later sitting to avoid a failure in an earlier one.**
Regenerate the groups with `node scripts/next-item.js --sittings`; this plan is a reading of that
output, not a replacement for it.

**⛔ Two standing blocks that outrank the order below.** The **admin console waits for `DV-13`**
(Lane A, still open) — and until it closes, **never open `/admin/oura-ble`**. That parks the whole
`admin-console-sitting` batch (`Q-318`, `Q-316`, `Q-544`, `Q-531`, `BF-10`, `LB-5`), so do not pick
those up in Sitting 2 even though they are tagged `app-shell`.

### Sitting 1 — known failures and regressions (do this one first)

Everything here has **already failed on a device or is a re-check of a shipped fix**, so it has the
highest chance of producing work rather than a tick.

- `BF-61` ① — the swipe tray's Delete needs two presses; **the fix FAILED on the device**, and the
  **meal-list half is still owed**.
- `DV-12` / `OR-162` — every tab tap holds the main thread 68–118 ms; `OR-162` names the two
  HR-today charts that re-measure on every tab switch.
- `RV-186` ②/③ — still failing from sweep 4b.
- `DV-19` — one treadmill walk shows as three rows.
- `DV-8` — **common**, 36 food-delete tombstones stuck `pending`.
- `RV-150` cold start · `BF-22` around an **active workout** (in-memory cache; needs the workout
  running, so plan it into this sitting rather than bolting it on).

### Sitting 2 — app-shell (35 owed, the largest group)

Best-placed: `BF-204`. Then `BF-205`, `BF-206`, `BF-208`, `RV-113`, `LB-162`, `RV-209`, `RV-210`,
`RV-146`, `RV-132`, `DV-6`, `RV-114`, `RV-115`, the `motion-polish` batch (`RV-71`, `RV-72`,
`RV-75`), `BF-145`, `PS-35b`, `BF-110`, `BF-111`, `BF-86`, `BF-80`, `Q-499`, `Q-491`, `Q-477`,
`Q-467`, `Q-281`, `LB-61`, `BF-5`.
**Skip the six `admin-console-sitting` entries** — blocked on `DV-13`, see above.
**This group is too big for one sitting.** Take it top-down and stop at the time box; what is left
rolls into the next one rather than being rushed.

### Sitting 3 — nutrition (18) + body (5) + workouts (17)

Adjacent logging surfaces, so one pass through the food/log/workout flows covers all three.
Nutrition from `RV-203`; body from `RV-108`; workouts from `RV-202`.
`BF-11` is a `Reference:` spec, not a check — **do not try to verify it**.

### Sitting 4 — devices (15) + readiness (9) + sleep (7)

Devices from `DV-13` — **but `DV-13` is itself the blocker above**, so treat its own check as the
first item and the rest of the group as gated behind it. Readiness from `RV-74`; sleep from `TN-85`.
Includes the `temperature-baseline` (`BF-13`) and `scale-weighing-ui` (`Q-104`) batches.

### Sitting 5 — platform (14) + activity (4) + cardio (1) + heart-rate (1)

Platform from `DV-21`, including `DV-18`'s **still-frame half**. Activity from `TN-78`. Then the two
singletons, `TN-25` and `OR-116`.

### Still owed from sweeps 4a/4b, fold into the matching sitting above

`RV-206` **P29–P31** (owner OK already given for font size, display size, battery saver) and
**P35–P38** → Sitting 2. `RV-155` **station C** (throwaway supplement writes) and the rest of
**B/D/E/F** → Sitting 3 for the write-heavy stations, Sitting 5 for the rest.

### The 10 entries BLOCKED until the phone answers

`PS-16`, `PS-12`, `PS-9`, `PS-8`, `Q-418`, `Q-545`, `Q-388`, `Q-114`, `Q-34`, `PS-7`.
**⚠ Not all ten are runnable now** — `next-item.js` says outright that some need an APK or hardware
built first, so the gate means *the phone is required*, not *a check is all that is left*. **Read
each entry before planning it into a sitting**; a blocked entry whose hardware does not exist is not
a check you can run, and discovering that with the phone in your hand is the waste this line exists
to prevent.
