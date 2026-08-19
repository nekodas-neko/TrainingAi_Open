# 2026-08-19 — Q-322 slice 5: the device ingest paths

**PR #198** · branch `fix/bounded-bodies-slice-5` · Implementation Lane A · JS/server only.

Eight routes: everything the ring, the strap and Health Connect push into, plus the admin backfills
that drive the same pipeline. `oura-ble/samples` — the highest-volume of them — was already bound and
is the reference the caps here are sized against.

| route | cap | derivation |
|---|---|---|
| `oura-ble/accel-chunks` | 512 KB | 20,000 magnitudes × 7 digits ≈ 160 KB at the schema's own limit |
| `hr-ingest` | 512 KB | 2,000 samples of `{at, bpm, rr[≤16]}` ≈ 240 KB at its limit |
| `sync-health` | 1 MB | three arrays × `MAX_ITEMS` (400) rows of bounded numbers ≈ 300 KB |
| `oura-ble/live-steps` | 4 KB | one window: two timestamps and a count |
| `oura-ble/rekey` | 4 KB | an optional note, truncated to 500 chars |
| `backfill-hr-stats`, `samples/backfill-null-decoded`, `samples/pack` | 4 KB | one tuning number each |

## A comment that described protection the code did not have

`sync-health` carried this, above a bare `req.json()`:

```
// Fail closed: a null / non-JSON / malformed / oversized body is a 400, never a throw.
```

The first three clauses were true. **"Oversized" was not** — `req.json()` buffers the whole body
before any schema can refuse it, so there was nothing between the route and a 20 MB payload. The
comment is now accurate and says what changed, because a comment claiming a guard that isn't there is
worse than no comment: it stops the next reader from checking.

## Four of the eight take an optional body, and that had to keep working

`rekey` and the three backfills are normally called **with no body at all** — the note and the row
limits are all optional. Converting them naively (treat `!read.ok` as a 400) would have broken every
ordinary call. They short-circuit only on `too_large` and otherwise fall through to their defaults,
exactly as the `try/catch` they replaced did. Verified by calling all four **with no body**: all 200.

`samples/pack` and `backfill-null-decoded` keep their surrounding `try`, so the failure shape around
them is unchanged too.

## Verified live

`pnpm dev`, seeded user promoted to admin for the admin routes and reverted after (confirmed back to
`f`; the `oura_ble_rekey_declarations` row the probe created was deleted — table now empty).

| | 10 MB body | malformed | valid |
|---|---|---|---|
| all eight | **413** | — | — |
| `accel-chunks`, `live-steps`, `hr-ingest`, `sync-health` | | **400** | — |
| `rekey`, the three backfills | | falls through (by design) | **200** with **no body** |
| `hr-ingest` | | | **200**, two samples stored |
| `sync-health` | | | **200**, a daily metric accepted |
| `backfill-hr-stats` | | | **200** — `{"maxRows":5}` → `processed: 5`, so the body value still reaches the handler |
| `live-steps` | | | **422** "No ring clock anchor yet" — its own domain logic, reached *past* the body read |

That 422 is the useful one: it proves the guard did not swallow a request the route was meant to
answer on its own terms.

Full suite against the local DB: **489 files / 4,138 tests green**. Custom Rules 49 of 49.

## A mechanical hazard worth recording

The script that inserted the import chose "the last line starting with `import`", which on
`hr-ingest` was the **opening line of a multi-line import block** — it spliced the new import into the
middle of the old one and produced five parse errors. `tsc` caught it immediately, but the lesson
generalises: when scripting an edit across many files, anchor on something that cannot be a fragment
of a larger construct.

## Not exercised

Production, and the APK — which for this slice is a real gap worth naming, because these are the
**device** ingest paths. Every probe here came from `curl`, not from the ring or the strap. The
payload shapes are pinned by the same Zod schemas the device posts against, and the caps are all
several times the schemas' own limits, but no APK actually pushed a batch through the new guards. The
`oura-ble/samples` sibling has been running with a 512 KB cap since it was written, which is the
closest thing to evidence that this shape holds on-device.
