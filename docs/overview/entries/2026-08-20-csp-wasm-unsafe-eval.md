# 2026-08-20 — the CSP could not start a WASM session, and nothing could have told us (Q-546)

**PR:** #TBD · branch `fix/csp-wasm-unsafe-eval` · Lane A

## What was wrong

`script-src` in production read `'self' 'unsafe-inline' https://accounts.google.com`. No
`wasm-unsafe-eval`, so **no WebAssembly session can start in the browser** — which blocks every
on-device model in the D-track. Verified against the deployed header with `curl -sI`, not just the
source.

`onnxruntime-web` is already a dependency and already has a parity test that passes. **That test
runs under Node, which enforces no CSP at all**, so it proved the model matched its TorchScript
golden while nothing could have loaded it in a WebView. This is the exact false-green the master
plan predicted.

## What changed

- **`'wasm-unsafe-eval'` added to `script-src`**, unconditionally. It permits WebAssembly
  compilation and nothing else — narrower than `'unsafe-eval'`, which it neither implies nor is
  implied by. Production still carries no `'unsafe-eval'`; dev's existing one already covers WASM,
  so dev is unchanged in effect.
- **The CSP moved to `lib/security/csp.ts`** as `buildCsp(isDev)`, imported by `next.config.ts`.
  It was inline in the config, where nothing could import it — which is why it had **no test at
  all**, and why a missing directive survived.
- **`connect-src` lost `cloud.ouraring.com` and `api.ouraring.com`.**

## The finding the extraction produced

Moving the CSP into `lib/` immediately turned `lib/oura/__tests__/no-cloud-calls.test.ts` red on the
new file. That guard exists to prove the deleted Oura Cloud integration stays deleted, and it had
been green — because it sweeps `app/`, `components/`, `lib/` and `packages/shared/src`, and the CSP
lived in `next.config.ts` at the repo root, which nothing swept.

So the production header had been permitting outbound connections to both Oura Cloud hosts for a
week after the integration was removed. Dead surface, invisible to the one test written to catch
exactly this.

The hosts are gone, and the guard now also sweeps `next.config.ts`, `auth.ts`, `middleware.ts`,
`instrumentation.ts` and `instrumentation-node.ts`. It asserts each of those is actually in the
swept set, so a rename fails loudly rather than quietly shrinking the sweep — the count floor of
1,000 files cannot see five going missing.

## Verified

- `pnpm dev` serves `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' 'unsafe-eval'
  https://accounts.google.com`, which also proves `next.config.ts` still loads the extracted module.
- New `lib/security/__tests__/csp.test.ts` — five cases: WASM permitted in production, eval **not**
  relaxed in production but present in dev, the closed directives stay closed, every remote image
  host also appears in `connect-src` (the service-worker refetch trap this file has hit twice), and
  dev differs from production only by the eval allowance.
- `tsc` clean · lint clean · **Ran 50 of 50 Custom Rules steps** · 4,349 unit tests pass.

## Honest limits

- **Not verified on device**, and there are two separate things owed. That the app still loads
  normally on the S25 under the new header — the APK is a WebView on the Railway URL, so it gets
  this header — and, separately, that a real WASM session instantiates. The second **cannot be
  asserted yet**: nothing runs WASM in the browser today. That assertion belongs to the PR that
  lands the first client-side model. A Known-Issues row records both.
- **Measured and deliberately not acted on:** `onnxruntime-web` 1.27 can create a worker from a blob
  URL when threading or the proxy worker is enabled, which `script-src`/`worker-src` would also have
  to permit. Whether that configuration gets used is a decision for the model PR, and widening a
  security header on speculation is the wrong order.
- **This is not a live user-facing fix.** Nothing is broken for anyone today; it is a blocker
  removed ahead of the work that needs it, which is what the entry asked for.
