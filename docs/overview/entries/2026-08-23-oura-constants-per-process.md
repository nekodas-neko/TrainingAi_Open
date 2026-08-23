# 2026-08-23 — `/api/body-battery` was 500ing in production, and boot said the constants were fine (LA-20)

**Branch:** `fix/oura-constants-per-process` · **Lane A** · server only, ships via Railway

Found by the `error_events` read that CLAUDE.md asks for at session start — which I had skipped, and
which is the only reason this was caught at all. It is not in any backlog entry.

```
/api/body-battery · server · daytime-stress: constants not set — call setDaytimeStressConstants() first
19 hits · first 2026-08-23 10:37 · latest 2026-08-23 12:27
```

Live, still firing while I read it, and caused by the constants port I shipped earlier (Q-545).

## Two independent faults, both hiding behind a green boot line

`instrumentation-node.ts` downloads the constants, sets `OURA_CONSTANTS_DIR`, injects them into the
four ports, and logs a successful delivery. Both of those effects are **per-process**, and the
process that runs boot is not necessarily the process that serves a request.

**Measured, not reasoned.** A throwaway probe route reporting the accessors' own state:

```
{"daytime":false,"steps":false,"dir":null}
```

`daytime: false` in a request handler, with boot having logged `model constants: fixtures`. On a
later run the same probe read `dir` as a real path while `daytime` was still `false` — so the two
failures are separable:

1. **Module-instance divergence.** The `let constants` inside `daytime-stress.ts` that boot wrote to
   is not the one the route reads. No env var fixes this.
2. **`OURA_CONSTANTS_DIR` not inherited.** Where that happens, `constantsDir()` falls through to
   `<cwd>/lib/oura-models/constants` — which has held no `.constants.json` since Q-49 removed them.
   So a route that *did* inject would fail differently, on missing files.

The route with no fault (`/api/oura-ble/step-counter-export`) is the one that calls
`ensureServerOuraConstants()` itself. Every path that injects works; the one that trusted boot did
not. That pattern is the whole diagnosis.

## The fix, one half each

**`constantsDir()` now prefers the delivered cache directory** over the empty tree, gated on its
`MANIFEST.json`. `constants-delivery.ts` already wrote to a deterministic `<cwd>/.oura-constants`,
so the files were findable all along — nothing was reading for them there.

**`getRepository()` injects.** It is the one thing every path that can reach a constants read
already goes through, it is server-only by construction (it pulls in `pg`), and it runs once per
process. Adding the call to `/api/body-battery` would have fixed one route and left the class — the
class is what put a 500 in production two weeks after the port shipped.

It uses a new **non-throwing** variant. `ensureServerOuraConstants()` throws when the directory is
unreadable, and the repository is on the path of every DB route in the app; letting it throw there
would turn "the stress tables are missing" into "nothing works", which is a strictly larger outage
than the one being fixed. Swallowing changes nothing a caller sees — the accessor still refuses at
the read site, exactly as today.

## Verified

Three mutations, each applied, run, and reverted:

| mutation | fails |
|---|---|
| remove the cache-dir fallback | `falls back to the delivered cache directory when OURA_CONSTANTS_DIR is unset` |
| remove `tryEnsureServerOuraConstants()` from `getRepository` | `injects the constants a request path can reach` |
| make the repository use the throwing variant | `still returns a repository when the constants are unreadable` |

Plus the probe re-run on the fix: `before {daytime:false, steps:false}` → `after {daytime:true,
steps:true}` across a single `getRepository()` call, in the request-serving process. Full suite 548
files / 4,537 tests; `pnpm check:rules` 52 of 52.

**Not verified: production.** The local reproduction is a dev-server worker split, which is not
proof that Railway's split is identical — what is proven is that the injection now happens in
whichever process serves the request, whatever the split. **The check that matters is
`error_events` after this deploys:** the fault must stop, and "it stopped" is not the same as "it
was fixed" until the count is zero across a window where `/api/body-battery` was actually called.
That is recorded as a Known Issue rather than struck here.

`/api/body-battery` also cannot 500 this way locally without a daytime-HRV model and baselines,
which the seeded dev user does not have — the model path is guarded and silently skipped. That is
why a green `pnpm dev` said nothing about it, and why `error_events` is the only thing that could
have.
