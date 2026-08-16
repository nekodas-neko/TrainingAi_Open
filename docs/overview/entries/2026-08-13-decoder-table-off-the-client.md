# 2026-08-13 — the step-decoder table leaves the browser bundle (Q-221)

**Branch:** `claude/trainingai-backlog-v0abea`

`steps_motion_decoder_2_0_0.constants.json` — the ring's own quantisation spec — was a static JSON
import inside `steps-motion-decoder.ts`, so webpack compiled it into client chunks. `middleware.ts`'s
matcher excludes `_next/static`, which means those chunks are served **with no session**. That is the
one thing failing the owner's rule that nothing derived from Oura's IP is reachable unauthenticated,
and it blocked the public cut.

## The change

The decoder takes the table **by injection** and **throws** when it is unset.

Throwing is the load-bearing decision. Every value the decoder emits is a physical quantity derived
from these bounds; with no table it would produce plausible, wrong stride frequencies and amplitudes
that flow straight into step counts and activity auto-detection. A caller that cannot supply the
table has to do nothing instead — and both client decode sites now do exactly that, gated on
`hasStepsDecoderConstants()`.

- `constants/client.ts` is **deleted**. It existed only to give the browser a static import, which is
  precisely what had to stop. Its types moved to `constants/steps-decoder-types.ts` — format, not the
  vendor's numbers, so it is safe to keep in our own code.
- `constants/index.ts` now reads the table from disk like every other constant. **It had been
  re-exporting from the client shim**, so even the server path went through the static import; that
  is why deleting the shim needed a real reader rather than just an import swap.
- `GET /api/oura-ble/decoder-constants` — session-gated, rate-limited, `private, no-store`, reading
  through the same accessor so there is still one source and the two paths cannot drift.
- The client fetches it once per launch from `startAutoDetection` and caches it via `cachedFetch`,
  seeding **synchronously** from cache first — so an offline cold start still works after one online
  session.
- `private-paths.json`: the OPEN ITEM saying this blocks `publish-dry-run --all` is resolved, and the
  stale `constants/client.ts` exclusion is replaced by the new types file.

## Verified — and the check needed care to read

A fresh `next build`, then a grep of the 154 client chunks. The first read looked like a failure:
`decoder_base_settings` still matched two chunks. It is **not** the data — those are the decoder's own
property accesses (`n.decoder_base_settings[t]`) and the new payload validator
(`e.decoder_base_settings&&"number"==typeof e.n_features_30s`). The identifier survives minification
because the code reads that field; the table does not.

The honest check is the **data**:

| grepped for | in client chunks |
|---|---|
| `sum_accel_mg_std` | **none** |
| `y_accel_std_ratio` | **none** |
| `stride_amplitude_frac` | **none** |
| `first_non_locomotor_frequency` | **none** |
| `frequency_bin_high_frac` | **none** |

The one `steps_motion_decoder` hit left is prose in an admin help string ("steps_motion_decoder →
step_counter) over the newest stored ring frames…"), not a table.

Full suite green — 464 files, 3,819 tests, zero failures. `tsc --noEmit` clean, lint 0 errors,
`pnpm check:rules` 33 of 33 (including *No vendor constants
inlined into publishable source*), `check-private-paths` OK, and `check-oura-models-dormancy` OK once
the deleted shim was staged — it fails on a tracked-but-unreachable file, which an unstaged `rm`
leaves behind.

**The decoder's refusal was proven before it was asserted.** Updating the decoder made
`steps-motion-decoder.test.ts` fail with `constants not set` — the contract working, unprompted. The
test now injects from disk as the rollup does, and a new case pins the refusal explicitly.

## What this does not do, stated plainly

**It does not hide the numbers from a signed-in user**, and cannot: anyone with a session can read
that route's response, and a value the client computes with has to reach the client. What it closes is
*publication* — the public bundle and the public repo, which is what the rule is about.

The only stronger option is decoding server-side and sending physical values, which would make
activity auto-detection depend on the network in an offline-first app. The plan recommends against it
and this change does not take it.

## Not exercised

**A cold offline launch on the device** — the case the caching exists for. `getLocalStore` returns
null in the sandbox and the BLE plugin does not run here, so the sequence that matters (one online
session, kill, relaunch with no network, walk) is device-only. Until then this is
NOT device-verified, and there is a Known-Issues row saying so.

Before the first successful fetch, ring-cadence confirmation and the cadence tracker do nothing.
That is the intended degraded state, not a regression — auto-detection is already best-effort — but on
a genuinely first-ever launch with no network it means no ring cadence at all until the app has been
online once.
