# 2026-09-28 — the local snapshot loader corrupted every packed raw frame

`scripts/local-db/snapshot.js` bound each NDJSON value as it arrived. A `bytea` column comes over as
`{"type":"Buffer","data":[…]}`, so the loader stored that JSON's text as the bytes. Every
`oura_raw_packed.blob` in a local snapshot, 1,580 of them, was unreadable
(`frame-pack: unsupported format version 0x7b`, `{`). Any local work over historical raw data read
nothing from the cold tier, without an error. TN-56's replay found it on its first real-data run.

The loader now finds each table's `bytea` columns and rebuilds a `Buffer` (Postgres's `\x…` text
form is accepted too). The conversion is a pure exported `restoreValue` with its own test, and the
script runs `main` only when executed directly. The snapshot database was reloaded with the fix:
1,580 blobs, none starting with `{`.
