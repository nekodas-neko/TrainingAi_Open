# RV-197 — `connect-src` ended in two schemes that allowed a WebSocket to anywhere

**Branch:** `lane-a/rv197-csp-connect-src` · **Lane A** · **security — owner confirms before merge**,
though this is the cheapest of the security items to approve: one line, reversible in one deploy.

## What it was

```
connect-src 'self' … https://*.tile.thunderforest.com wss: ws:
```

`connect-src` is the directive that would otherwise stop injected script sending data off-origin —
and the blanket at the end of the list undid most of the rest of it. Nothing needed it.

## Both of the entry's claims reproduce, and one check is stronger than the entry's

- No `WebSocket` is constructed anywhere in `app/`, `components/`, `lib/` or `packages/`, and there
  is no ws client in `package.json`.
- `https://generativelanguage.googleapis.com` appeared **nowhere in the repository except that
  line**. Gemini is called through `@ai-sdk/google` on the server; the browser never connects to it.

A source grep cannot see a dependency doing either, so I built the app and grepped the **emitted
client bundles**: zero hits for `generativelanguage`, zero for `WebSocket(`, and zero `ws://`/`wss://`
literals of any kind.

`ws: wss:` is now conditional on `isDev` rather than deleted — the dev server's HMR socket is a real
consumer. If a production feature ever needs one, the answer is to name its host (`wss://host`), not
to restore the scheme.

## The mutation control found a test that was too tight

`dev and production differ only in the eval allowance` compared the two strings literally. Extended
to cover the ws schemes, it then failed when they were merely **reordered** — a change that changes
nothing. It strips them by pattern now, and still catches what it exists to catch: a third
difference between dev and production that nobody decided on.

That fell out of the equivalent control, which is exactly what an equivalent control is for.

## Verification

- `lib/security/__tests__` + `lib/media/__tests__/no-data-url-fetch.test.ts` — **21 passed**.
- **Mutation pass: baseline survives, 4 killed, 1 equivalent control survives.** Killed: restoring
  the schemes unconditionally; restoring the Gemini host; dropping ws from dev too; removing a real
  image host from `connect-src` only (the service-worker refetch rule). Control: swapping the order
  of the two ws schemes — which killed the test until the test was loosened, and survives now.
- `tsc` 0 · `lint` 0 · `build` 0 · Custom Rules **83 of 83** · full suite below.

## Local run (2026-09-27, second session)

- **`pnpm dev`:** signed in and loaded Sign-in, Home, Health and Nutrition with the console
  filtered for `Content Security Policy`/`Refused`: **no violations**. The dev header's
  `connect-src` still ends in `ws: wss:` (hot reload needs them) and has no
  `generativelanguage.googleapis.com`, as intended.
- **Client code opens no WebSocket and calls no Gemini host directly.** A repo-wide search for
  `new WebSocket`, `EventSource(` and the Gemini hostname finds only `scripts/device/cdp.js`, a
  Node-side DevTools script outside the page.
- **The production header is still not read off the wire.** `next build` succeeded locally, but
  `next start` refuses to boot: the storage keys in the local `.env.local` are rejected by the
  bucket (`SignatureDoesNotMatch (403)`), the same failure the cloud container hit. That refusal is
  the instrumentation hook failing closed on purpose, so the fix is fresh keys, not a code change.
  (On Windows the `build` script's `NODE_OPTIONS=…` prefix does not run under `cmd`, so its two
  steps were run directly.)

## Not exercised

- **The header was never read off the wire.** `pnpm start` cannot boot in this container — the
  instrumentation hook needs S3 credentials for the vendored model constants — so what is verified
  is `buildCsp(false)`'s output and the bundles, not a live response.
- **Nothing on the device.** A header change reaches the WebView through a normal Railway deploy;
  no APK. If something unforeseen did want a WebSocket in production, the symptom would be a
  console CSP violation and that feature failing — visible, not silent.
