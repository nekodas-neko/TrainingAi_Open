# Plan — stop shipping the step-decoder table to the client (Q-49 A3c)

_2026-08-13 · Domain `devices` / `platform`. The last thing publishing the repo would expose._

## Measured, 2026-08-13 — the exposure is real, live, and exactly one file

The owner's second statement sharpened the test: *anything derived from Oura's IP should not be
accessible from a non-authenticated user.* That is checkable, so it was checked rather than reasoned
about.

| Surface | Result |
|---|---|
| Unauthenticated API routes | 5 exist (`auth/*`, `version`, `status`). **None serve Oura-derived data.** |
| The client JS bundle | `middleware.ts`'s matcher explicitly excludes `_next/static`, so **chunks are served to anyone, no session.** |
| Decoder table in those chunks | **Present in 2 chunks**, one of them `app/layout-*.js` — every page load. |
| Anything else Oura-derived in the bundle | **None.** `sleepnet`, `cumulative_stress`, `stress_resilience`: zero chunks. Server-only. |

So the rule has **exactly one violation**, and it is live in production today rather than only a
migration concern. Everything else already satisfies it.

## The owner's rule, and what it decides

> **Nothing from Oura should be published to the public internet unless we have modified it in some
> way to make it unique to us.** — owner, 2026-08-13

That settles a question I had answered the other way. `steps_motion_decoder_2_0_0.constants.json`
(3.5 KB) is compiled into the browser bundle today, and I argued that withholding a file already
shipped to every user hides nothing. The rule says the file is not the point: **the numbers must not
be public**, and they currently are.

**It cannot be satisfied by transforming the table.** Each entry is the ring's own quantisation
spec — `total_amplitude_mg: {low: 0, high: 8000, bits: 9}` — the parameters the *ring* used to pack
the value into 9 bits. Change any of them and the decode produces wrong physical values. This is a
wire format, not a tunable, so "make it unique to us" has no meaning here. The only way to comply is
to stop handing it out.

## Why the client has it at all

`app/layout.tsx` mounts `AutoDetectionProvider` on every page → `auto-detection-service.ts` →
`steps-motion-decoder.ts`. Ring step frames are dequantised **on the device**, for activity
auto-detection and cadence. `cadence-tracker.ts` does the same. This is a live feature, not a
leftover — removing the client path is not an option.

## The change

**Serve the table from an authenticated route; inject it into the decoder.**

1. `GET /api/oura-ble/decoder-constants` — session-gated, returns the `attributes` bag. Reads it
   through `getStepsDecoderConstants()` server-side, so there is still one source.
2. `steps-motion-decoder.ts` stops holding `const K = getStepsDecoderConstants()` at module scope.
   It gains `setStepsDecoderConstants(k)` and an internal `getK()` that **throws** when unset —
   a decoder running on absent constants would emit plausible wrong numbers, which is worse than
   failing.
3. Server callers (`step-counter-pipeline.ts`, the rollup) inject from disk at first use — no
   behaviour change, no network.
4. The client fetches once at startup and caches in the local store, so **offline still works after
   the first successful fetch**. Auto-detection is already best-effort; before the first fetch it
   should do nothing rather than guess.
5. Delete `constants/client.ts` — with nothing static left, the whole tree is server-read again and
   the exclusion list shrinks back to our own code.

## What this does not fix

**A determined user can still read the numbers**, by watching the authenticated request from their
own session. That is unavoidable for any value the client computes with, short of moving the decode
server-side entirely (option below). The rule as written is about *publication* — a public repo and
a public bundle — and this closes both.

**The alternative, if that is not enough:** decode server-side and send the client the physical
values. It removes the numbers from the device completely, and it makes activity auto-detection
depend on the network — a real product regression for an offline-first app. Not recommended, but it
is the only stronger option.

## Sizing and sequencing

One session. It does not block anything else in Phase A, and it does not block Phase B *except*
that `publish-dry-run --all` cannot be green until it lands — which is precisely the signal the
repo should not be published yet.

**Verify:** `--all` green with `steps_motion_decoder_2_0_0.constants.json` back in the private set;
`next build` clean (the real check for a client chain — a grep cannot see three hops through `lib/`);
and on-device, that auto-detection still starts a walk after a cold launch with the network off
following one online session.
