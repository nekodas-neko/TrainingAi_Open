# Oura model constants — not in this repository

This directory holds the **loader**, not the constants. The numeric constants are Oura Health Oy's,
extracted from their decrypted on-device `.pt` model binaries, and they were removed from this
repository when it went public (Q-49 A4b). See the [`NOTICE`](../../../NOTICE) at the repo root.

What is here is ours and stays:

| File | What |
|---|---|
| [`index.ts`](./index.ts) | The runtime loader — reads JSON out of `OURA_CONSTANTS_DIR`, one getter per model |
| [`steps-decoder-types.ts`](./steps-decoder-types.ts) | Type declarations for the step-decoder table: its shape, not its numbers |
| [`__tests__/`](./__tests__/) | The loader's own tests |

## Where the files come from at runtime

`lib/oura-models/constants-delivery.ts` downloads them from private object storage during server
boot and points `OURA_CONSTANTS_DIR` at the result; `instrumentation-node.ts` fails the boot in
production if that does not succeed. A machine that still has a local copy of the directory is
preferred over the download, which is what makes local development work without credentials.

**A clone with no such source configured has no constants**, and `index.ts` throws rather than
returning a default — deliberately. The ONNX loaders are infallible by contract because a missing
model has a degraded fallback; a missing constant does not, and would be a wrong number, silently.

The test suite runs against synthetic fixtures instead (`lib/oura-models/__fixtures__/constants/`,
built by `scripts/generate-test-constants.js`): every key preserved, every number replaced. Tests
whose assertions depend on a real magnitude guard themselves with `hasRealConstants()` from
[`../__fixtures__/real-constants.ts`](../__fixtures__/real-constants.ts) and skip where the vendor's
files are absent. A green suite is evidence about the pipeline, never about a constant's value.

## File format, for whoever holds a real copy

Each `<model>_<version>.constants.json` has the envelope
`{ source: { file, sha256, size_bytes, version[, weights_npz] }, params_and_buffers, attributes, errors }`.
`MANIFEST.json` maps every model to its source-`.pt` sha256, and `verifyConstantsIntegrity()`
cross-checks each loaded file against it.

Two properties of that archive matter and are easy to lose:

- **Do NOT regenerate them from a re-onboarded ring.** The reverse-engineered BLE protocol is stable
  only against the frozen firmware, and re-onboarding the vendor's own app can push an update that
  changes the event encodings. See the Oura Direct-BLE rules in `CLAUDE.md`.
- **The one transform applied.** The extractor emitted Python `NaN`/`Infinity` sentinels, which are
  invalid JSON, so those **value tokens** are stored as `null` — how the ports already treat them.
  Value tokens only: message strings containing the word "NaN" are left intact, and `source.sha256`
  is untouched, so provenance survives the transform.

## Usage

```ts
import { getStepsDecoderConstants, getOtsConstants, modelVersion } from '@/lib/oura-models/constants'
```

One-Constant-One-Source: import from here; never hardcode a number that lives in a constant. Prefer
server-side use — these are consumed by `aggregateOuraRawSamples`, not the client. The one table the
device needs is served from `GET /api/oura-ble/decoder-constants` rather than bundled.
