# 2026-09-30 — OR-205: a food's stored source no longer comes from the model's confidence

**Branch:** `fix/or205-source-not-from-confidence` · **Lane A** · removes `OR-205` from the queue.

## What was wrong

`scanOriginToSource(origin, confidence)` fell back to `confidence ? 'ai' : 'manual'` when a scan
result carried no `origin`. The barcode and Open Food Facts search producers set one, but
**`/api/nutrition/scan` (photo, typed text, recipe URL) never did**, so every model scan reached
the fallback and the model's self-reported confidence decided the stored `food_items.source`.
The AI defaults in `CLAUDE.md` forbid an LLM self-reported number gating an automatic action.

## What changed

- `ScanOrigin` gains `'text'` and `'url'`. The scan route sets `'photo'`, `'url'` or `'text'`
  by which input it read, on **every candidate**, because the candidate the user picks is the one
  that gets logged. The top level stays equal to `candidates[0]`, which the multi-candidate test pins.
- `scanOriginToSource(origin)` drops the confidence parameter: any model or OFF origin maps to
  `'ai'`, `'barcode'` to `'barcode'`, and no origin to `'manual'`.
- The "AI confidence" bar on the review step is **untouched**: whether it stays is `PS-31`'s
  question and the owner's.

## Verified

- Unit: `barcode-image-chain.test.ts` (the mapper, with its arity pinned at 1) and
  `multi-candidate.test.ts` (the route stamps `origin` on the top level and every candidate).
  `components/nutrition` + scan route suites: 555 passed.
- `pnpm dev` on the owner's snapshot: a real Gemini text scan returned `origin: 'text'` on the top
  level and on its candidate.

## Not exercised

The log itself writes through the on-device local store, which does not run on the web, so the
stored `source` of a scanned food was checked through the mapper's tests and not by a row on the
APK. No photo or URL scan was run live; they take the same assignment as the text branch.
