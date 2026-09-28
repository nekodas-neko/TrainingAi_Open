# 2026-09-28 — RV-153's remaining fix is the cache layer, not a store

**Lane B.** Branch `docs/rv153-cache-mirror-is-lane-a`. Docs only — no code, no version bump.

## Why this is a re-lane and not a build

`RV-153` was Lane B's #7 and its device probe is already answered (sweep 4a: ~120k characters of
`localStorage` rewritten per Home tap, `friends-feed` at 459k). It was re-laned from `DV` to `B` on
2026-09-26 on the reasoning *"stores and hooks are Lane B"*. That is true and is not where the bytes
come from.

**Every key the probe named is written by one line** — `lib/sqlite/cache.ts:82`,
`localStorage.setItem(LS_PREFIX + key, JSON.stringify(entry))`. `workout-data:meta`,
`workout-card:<id>`, `sleep-sessions`, `friends-feed`, `oura-hr-day:<today>`, `exercise-library`,
`saved-meals` and `body-battery` are all `cachedFetch` keys. **Not one is a Zustand store**, so no
`partialize` change touches any of them. `lib/sqlite/**` is Lane A's by the path list, and the entry's
own rule already said so: *"the fix goes to Lane A if it is the cache layer."*

## What I established so Lane A does not have to

- **Three serialisations per write, not one.** `setCached` calls `ssWrite` (`JSON.stringify(data)` →
  sessionStorage), then `lsSet` (`JSON.stringify(entry)` → localStorage), then on device `runSQL` with
  another `JSON.stringify(data)` → SQLite. A Home tap's ~120k is stringified roughly **three times,
  ~360k on the main thread**. The probe measured only the localStorage leg, so the real cost is higher
  than the entry states.
- **⛔ The obvious fix is unsafe on web and safe on device.** "Skip the rewrite when the payload is
  unchanged" freezes `cachedAt`, and `isFreshWithinTtl` (`cache.ts:319`) reads exactly that. On web
  localStorage *is* the primary store, so a frozen stamp ages entries out early and causes **more**
  network fetches — it would defeat `freshWithinTtl` on `nutrition-targets`, `more-seasons` and the
  exercise catalogue. On the APK that function reads `api_cache.cached_at` from SQLite instead, so the
  localStorage stamp participates in no freshness decision.
- **And the relaunch seed survives a skip, which is what makes it cheap.** The localStorage leg exists
  on purpose — *"survives APK kills so `readCacheSync` can serve instant data on relaunch"* — but it is
  written through `floorSeedTtl`, and `OFFLINE_SEED_TTL_FLOOR` is **7 days**. On an unchanged payload
  the stored bytes are already correct and the stamp has days of headroom. **So the shape that works:
  on device only, skip the `setItem` when the serialised data is byte-identical.**
- **`ta_nav_timing_v1` is not worth splitting out.** `lib/perf/nav-timing-recorder.ts` already caps its
  buffer (`loadSamples` slices to `NAV_SAMPLE_LIMIT`), so its 5.4k is 4.5% of a Home tap and bounded by
  design. Left alone deliberately rather than filed as a separate entry.

## Deliberately not done

**Not measured.** Whether the skip moves `DV-12`'s numbers, and whether the `getItem` + compare it
needs costs more than the `setItem` it avoids, are both open — the analysis above is from source.
`DV-12`'s `perf.js longtasks` bar (every tab tap's longest task under 50 ms) is the test, and taking it
is Lane A's along with the change.

RV-153 keeps its queue position, which puts it at **26** in Lane A's list — below the ten-row default
view. That is its inherited priority and I did not raise it: it is a perf optimisation feeding `DV-12`,
not a correctness bug, and jumping it over two dozen security and data entries is not mine to do.
