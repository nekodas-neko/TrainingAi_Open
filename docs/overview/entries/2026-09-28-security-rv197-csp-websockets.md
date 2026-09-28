# 2026-09-28 — RV-197: production CSP no longer lets a page open a socket to any host

**Lane A · security · held for the owner's merge-time yes (RV-221).**

- **Change:** `connect-src` in `lib/security/csp.ts` emits `ws: wss:` in dev only, where HMR needs
  them. Nothing in `app/`, `components/`, `lib/` or `packages/` opens a WebSocket or an
  EventSource (grepped). The unused `generativelanguage.googleapis.com` is removed too: Gemini is
  called from the server.
- **Tests:** `csp.test.ts` now fails on any bare-scheme source in production `connect-src`. The
  "dev differs from prod only by eval" invariant names the HMR socket as the second allowed
  difference.
- **Not exercised:** a production build in a browser. `pnpm dev` serves the dev policy, so what
  production loses is only visible on device after deploy. The one thing to watch is a CSP
  violation in the WebView console naming `ws:` or `wss:`.
