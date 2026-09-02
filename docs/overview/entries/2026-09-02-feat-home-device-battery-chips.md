## 2026-09-02 — device battery chips on the Home header (Q-111, v1.429.0)

**Branch:** `feat/home-device-battery-chips` · **Lane:** B

The owner asked for small icon+battery chips on Home for the ring, chest strap and scale — ring
always-current, strap/scale live-when-connected and last-seen-when-disconnected.

### The entry was wrong about both halves, and finding that out was most of the work

- **It claimed the ring half was done and on the Home header.** There was no `oura-battery-chip.tsx`
  and no chip in the header — `session-select-content.tsx` rendered `WeatherChip` and nothing else
  beside the date. The ring battery rendered on Health and More only, which fits the v1.270.30
  changelog's own wording, *"The chip existed but was reading the Oura Cloud value"*. **Git could not
  arbitrate whether it regressed or never reached Home:** history begins at the public snapshot on
  2026-08-16, after the 2026-08-08 claim. So the ring chip was simply built.
- **It claimed no JS call site reads the strap battery.** `chest-strap-pairing.tsx` reads the Battery
  Service characteristic over browser BLE while pairing and renders `Battery N%`. The true half is
  that **nothing reads `PolarBleStatus.battery`** — the native service's value — and nothing persists
  either number. So the defect was never a missing read; it was **two numbers in two screens with no
  relationship**.

### What shipped

- `components/home/header-chips.tsx` — the header row: weather, then whichever devices have a
  reading.
- `components/device-battery-chip.tsx` — the shared pill. Presentational and scalar-only, because
  the two call sites differ entirely in where their number comes from.
- `lib/stores/strap-battery.ts` — the last-seen value, in `localStorage` with a timestamp.
- `lib/hooks/use-strap-battery.ts` — seeds from the store, then subscribes to `polarStatus` and
  calls `getStatus()`, writing every reading back.
- `chest-strap-pairing.tsx` now writes its reading into the same store. **The direct read stays** —
  at pairing time the native service is not running, so it is the only source there is — but it stops
  ending at a local `useState`. One store, two writers, so the chip has a value from the first
  pairing rather than waiting for a workout.

### Decisions

- **A stale reading is shown muted, not hidden.** A chip that vanishes on disconnect reads as "no
  strap" rather than "not connected right now", which is a chest strap's state most of the day. Age
  goes in the accessible name: the pill has room for a number and not a sentence.
- **`localStorage`, not a user preference.** It is a fact about one strap paired to one phone —
  syncing it would carry a lie to a second device.
- **The store refuses an implausible percentage** rather than storing it. A strap that has not
  finished its first Battery Service read reports `null`, and a stored `0` would render as a flat
  battery forever.
- **⚠ The header could not grow.** `session-select-content.tsx` is shrink-only in
  `check-component-size.js`, and the rule there is extract rather than append. The one `WeatherChip`
  dynamic-import line and its one usage became `HeaderChips` — **net zero** — with the new chips
  inside it.
- **`useCachedValue`, not a fetch-once effect.** The header is in the persistent tab shell, so a
  `useEffect(…, [])` around `cachedFetch` would hold its first payload until the app is killed
  (Q-402). `check-fetch-once-effects` caught the first draft doing exactly that — the rule earned its
  place again. `today: true`, because the existing Health site calls `cachedFetchToday` and the
  variant is a property of the key.
- **No scale chip.** No battery capability exists for it anywhere, not even a one-shot native read.
  A chip that could never have a value is worse than its absence.

### Verification

- `lib/stores/__tests__/strap-battery.test.ts` — 17 tests. **Seven mutations kill it:** storing an
  implausible percentage, trusting whatever JSON is present, the pairing screen not recording, the
  chip growing its own source, a second cache key for the ring, the hook not listening to
  `polarStatus`, and reverting to a fetch-once effect.
- `e2e/home-device-battery-chips.spec.ts` — 3 tests, **four mutations kill them**: dropping the
  weather chip in the swap, not rendering the strap chip, hiding a stale reading instead of muting
  it, and drawing a chip for a device with no reading.
- **One of those mutations initially survived, and the test was weak rather than the code wrong.**
  `toHaveCount(0)` is satisfied by a page that failed to render at all, so the "no chip without a
  reading" test passed against a header crashing on a null ring — the exact defect it exists to
  catch. It now anchors on a chip that *is* present first. That is the "assert the matcher found
  something" rule, hit again.
- **The weather assertion needed two stubs**, and without them it failed against a working header:
  `open-meteo` is an external host the egress proxy drops, and without granted coordinates
  `useWeather` never asks for it. A spec failing for its own reasons is indistinguishable from a
  broken feature until you look.
- `pnpm check:rules` **Ran 67 of 67**; full unit suite (738 files, 6,275 tests), tsc and lint clean.

### Not exercised

- **The device, twice over.** Three pills now share a header row that BF-96 already found compresses
  badly at 412 dp when the date is long. **And the strap's live path has never executed** —
  `getPolarBle()` returns null off-device, so every strap reading in every test here came from the
  store, not from a strap.
- The ring chip has no data in the sandbox either: the seeded account has no BLE battery reading, so
  only its absence is covered.

### Left for the owner

The scale (new Kotlin BLE work, not Lane B's, and flagged a stretch), and whether the header's manual
refresh button should go. Measured rather than guessed: pull-to-sync bumps `refreshTick`, which drives
Body Battery, training-load, muscle-recovery and the HR chart; **the manual button does not bump it at
all**, so it is strictly narrower rather than merely redundant. That supports removing it — against
the real counter-consideration that a visible button is discoverable and a gesture is not.
