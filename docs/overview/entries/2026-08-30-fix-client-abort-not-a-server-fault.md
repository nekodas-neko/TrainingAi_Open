# 2026-08-30 — LB-14: a client hanging up was being filed as a server fault, and only one of the two fix shapes is safe

**Branch:** `fix/client-abort-not-a-server-fault` · **Lane:** A · **Domain:** platform

## What it was

`POST /api/oura-ble/samples` and `POST /api/oura-ble/battery-poll` wrote bare `aborted` rows to
`error_events`. `readJsonLimited` streams the request body through `reader.read()`, which rejects
when the inbound stream is cancelled — the native BLE service being backgrounded mid-post. Nothing
caught it, so it reached Next's `onRequestError` and was reported to **both** `error_events` and
Sentry.

It matters because `error_events` is the table every session reads to orient, it prunes at 30 days,
and Q-315 measured it at 52 MB of genuinely live rows.

## Two premises corrected

**The count.** The entry recorded *"nine in the 30-day window"*. Measured against production today:
**100** — 76 on `samples`, 24 on `battery-poll` — and still arriving, the most recent today.

**Its shape, which changes what the rows are worth.** 95 of the 100 fall in a five-day burst,
2026-08-09 → 08-13, which is the same window as the `[pg 21000]` fault and the connection-timeout
rows. Since then it is about one every few days. So these are not steady background noise: **they
are loudest exactly when something real is already wrong**, adding non-faults to the record at the
moment it is being read for a live incident.

## Reproduced, which the entry explicitly had not done

The entry says *"read from source, not reproduced"*. A chunked `POST` whose socket is destroyed
mid-body, against the dev server with a real session, throws:

```
Error { name: 'Error', code: 'ECONNRESET', message: 'aborted' }
```

**It is not a `DOMException`,** so the obvious `err.name === 'AbortError'` guard does not match it.
That is worth knowing before anyone writes the guard from memory.

## Why the helper, and not the reporting layer

The entry offered two shapes and said *"either way"*. The reproduction shows only one is safe:

- **At `recordRequestError` (wider).** The only structured signal available there is
  `code === 'ECONNRESET'` — which an **outbound** fetch to a third party also raises, and that one
  *is* a server fault worth recording. The alternative is keying on the message text, which is the
  fragile thing the entry itself warned against.
- **At the read (shipped).** `readJsonLimited` is the only place that knows the reset came from the
  *inbound* body. It returns `{ ok: false, reason: 'aborted' }`, the route answers 400, and nothing
  throws — so nothing reaches the reporting path at all.

Additive for all **109** callers: every one branches on `too_large` and treats the rest as a 400,
which is what an abort already produced through `invalid_json`. Same shape as the `empty` reason
added earlier.

## Verification

End-to-end against a dev server, both directions, with `error_events` emptied first:

| | aborts fired | rows written |
|---|---:|---:|
| with the catch | 3 | **0** |
| catch removed (control) | 1 | **1** — `POST /api/oura-ble/battery-poll \| aborted` |

The control matters as much as the fix: without it, "zero rows" is equally consistent with having
broken reporting altogether. The row that appears is byte-for-byte the production signature.

Also: unit test mutation-verified (removing the catch fails it with the raw `Error: aborted`
escaping), `tsc --noEmit` clean, `pnpm check:rules` **Ran 62 of 62**, full suite green.

**Not exercised:** an abort that happens somewhere other than the inbound body read — mid-response
streaming, say — still reports, and that is unchanged by this. No device path changed and no
user-visible behaviour changed, so no device check is owed and no version bump.

**Scope of the production numbers:** `claude_ro` is row-scoped to one user, so 100 is the owner's
rows only. The real total across accounts is higher.
