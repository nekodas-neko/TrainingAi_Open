## 2026-08-08 — `feat/home-device-battery-chips` — Q-111 ring half: the chip that was already there, reading the wrong source

Q-111's ring half. **The entry stays open** — its strap and scale halves are genuinely unbuilt and
need native work.

### The finding was already in the entry, and it was right

> *"a chip component (`oura-battery-chip.tsx`) exists but reads the wrong, frozen Cloud source and
> is effectively dead — fix its source, don't add a second chip."*

Confirmed by reading it: it fetched `batteryLevel` from `/api/oura/token` — the Oura **Cloud**
value, frozen since the 2026-07-07 re-key — and then `if (!battery) return null`'d itself whenever
`batteryStale` was set, which is always. So the component rendered nothing, anywhere, and had been
doing so since the re-key.

`/api/oura-ble/battery-latest` has been serving the live BLE poll (`percent`, `charging`, `tsMs`,
`ageMinutes`, 3-day window) the whole time.

### What shipped

- Source swapped to `/api/oura-ble/battery-latest`, and the chip wired into the Home header beside
  the weather chip.
- **Reuses the `oura-ble-battery-latest` cache key** that `health/oura-section.tsx` already owns,
  **with the same `cachedFetchToday` variant**. Both halves of that matter per CLAUDE.md: a second
  key for one endpoint causes stale/blank first paints, and mixing `cachedFetch` with
  `cachedFetchToday` on one key makes freshness last-writer-wins.
- **Staleness is shown, not hidden.** Past 3h the percentage renders muted and the aria-label reads
  "last seen Nh ago". Hiding it would repeat what the Cloud chip did wrong in the other direction;
  showing it at full confidence would repeat it directly.

**Two latent bugs in the same file, fixed while there:**

1. `readCacheSync` inside a `useState` **lazy initializer** — the exact pattern CLAUDE.md names as a
   React hydration mismatch ("seed in a `useEffect`, never in a lazy initializer"). Now an effect.
2. Five hardcoded `rgb()` literals for the battery bands → theme tokens. `--accent-orange` does not
   exist, so the 10–25% band shares `--accent-amber` rather than inventing a token for 15 points of
   range; the icon still distinguishes them.

### A regression I introduced and caught

The chip pushed the header date onto two lines at the 412px viewport ("Sunday 9 / August"). The date
is now `whitespace-nowrap shrink-0` so the chips compress instead. Verified in the after-shot.

### Verification

- `tsc --noEmit` clean · `eslint` 0 errors · full suite green · all nine custom-rule scripts pass.
- **Rendered against a real API response**, by seeding one `oura_ble_battery_poll` row 20 minutes old:

  ```
  API:  {"latest":{"percent":47,"charging":false,"tsMs":…,"ageMinutes":23}}
  CHIP: {"aria":"Ring battery 47 percent","text":"47%"}
  ```

  The seeded row was **deleted afterwards** — so a future session testing this needs to insert one
  (`insert into oura_ble_battery_poll (user_id, measured_at, percent, charging) …`); the local seed
  has no battery data.

### Not exercised

No device run — no native path touched; the BLE poll that fills this table is written by the Kotlin
service, which is unchanged.

**Only the fresh (<3h) state was rendered.** The stale branch, the charging branch, and the
low/critical colour bands were not — they are straight-line conditionals off one number, but they
were not seen. **The weather chip rendered empty locally** (no weather data), so the header was
verified with one chip present, not two; in production both sit on that line and it will be tighter
than what I saw.
