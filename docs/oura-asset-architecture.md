# Where the third-party model assets live — decided architecture

_Owner decision, 2026-08-13. Rescued from pull request #1315 on the archived private repository,
which could never be merged once that repo was archived on 2026-08-17._

> **Status, corrected 2026-08-17.** The original recorded this as pending and marked the on-device
> tier ❌. **All of it has since shipped**, which is what makes this a description of the system
> rather than a proposal: the models and constants are served from object storage, the one table the
> device needs comes from an authenticated route (Q-221, #1323), and the repository carries none of
> it (Q-49 A4b). The original also edited the cut runbook to call this a blocker; that edit is
> dropped, because the cut is done. See [`NOTICE`](../NOTICE).

## The goal, in the owner's words

> *We are wanting to use a public GitHub repo which anyone can view — this is where we don't want our
> Oura data. We don't want to hide the Oura stuff from our authenticated users. My suggestion is that
> everything Oura related is in the S3, it gets pulled down onto the APK at first runtime and can
> live there if that's more efficient than reaching out to S3 every time.*

**The threat model is the public repository, not the running app.** Worth stating, because it makes
several things that looked like requirements stop being requirements.

## The rule, in one line

**Nothing vendor-derived in the repository. Everything vendor-derived in object storage. The device
pulls what it needs once and keeps it.**

## Three tiers, and where each sits

| Tier | Source | Status |
|---|---|---|
| Server models (`.onnx`) | Object storage, fetched by `getSession()`, memoised per process | ✅ shipped |
| Server constants | Downloaded at boot by `constants-delivery.ts`; the loader reads that directory | ✅ shipped |
| On-device | Object storage → authenticated app route → local cache | ✅ shipped (Q-221) |

## How the device gets its half

**Device → authenticated app route → server reads object storage → device caches locally.**

The device never holds bucket credentials, which is the only reason to involve the server at all. It
is not an access-control measure — authenticated users are explicitly not the concern — it is that
storage credentials on a device are a credential you cannot rotate.

Rejected alternatives, and why:

- **Device talks to object storage directly.** Needs credentials on the device, or a public bucket.
  A public bucket puts the material back on the public internet, which is the thing being avoided.
- **Presigned URLs.** Works, but adds expiry and refresh logic to buy nothing here — the proxy route
  is simpler and the payloads are small.
- **A Postgres table synced per user.** These are static, protocol-frozen assets identical for every
  user. A table stores the same bytes once per account and adds a migration; the database is for user
  data.

## Cache on the device — and this is not a marginal call

- The step decoder runs **per BLE frame** during activity detection. A network round trip per decode
  is not a slower design, it is a broken one.
- The app is **offline-first**. Anything fetched per use stops working in a tunnel; anything cached
  works after the first successful sync.
- The assets are **frozen by the protocol-freeze rule** — they never change, so there is no staleness
  cost to caching them indefinitely.

Fetch once, store in the local SQLite store, read from there forever. Re-fetch only when a named
version changes, which currently never happens.

**Before the first fetch, features that need an asset must do nothing rather than guess.** A decoder
running on absent constants emits plausible wrong numbers, and plausible wrong numbers are worse than
a missing feature — the same reasoning that makes the server-side loader throw instead of degrading.

## What this does not claim

An authenticated user can read anything their device holds. That is accepted, not overlooked: the
concern is the public repository. This architecture makes the material **non-public**, not secret, and
no part of it should be described as the latter.

## Consequences for development

The files are not in the repository, so three consumers need them supplied another way:

- **Production** — object storage, as above. The boot check fails the deploy rather than serving a
  degraded result quietly.
- **CI** — solved: the model tests replay recorded outputs and the constants fall back to synthetic
  fixtures, so CI needs no assets and holds no credential. A public repo's test suite must not
  require secrets.
- **Local `pnpm dev`** — needs a local copy pointed at by `OURA_CONSTANTS_DIR`. A fresh clone will not
  have one, and the failure is a thrown loader rather than a hint.
