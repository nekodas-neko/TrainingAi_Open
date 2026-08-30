# 2026-08-30 — The map that stops you re-implementing things was wrong 108 times

**Lane A · branch `fix/module-map-shared-paths` · LA-35 · filed and fixed the same day**

`CLAUDE.md` names this trap under **One Formula, One Place**:

> Most of it is in `packages/shared/src/`, not `lib/` — the monorepo extraction moved it and this
> rule kept saying `lib/` for months (Q-153). Check `docs/module-map.md` for where a given formula
> actually is rather than guessing a directory.

The map it sends you to was wrong the same way. **108 paths across 8 orientation documents** — 92
files and 16 directories — named `lib/<x>` for something living at `packages/shared/src/<x>`. The
filed figure of 34 counted only the distinct `lib/health/*.ts`; the sweep found the rest.

## Why it survived a check written to catch exactly this

`scripts/check-index-doc-paths.js` exists (Q-554) so an orientation doc cannot name a path that does
not exist. Its `resolves()` ended with:

```js
'packages/shared/src/' + p.replace(/^lib\//, '')
```

So a `lib/` path resolved whenever the file turned out to live under `packages/shared/src/`, and all
108 reported OK. That is not a lenient edge case — it is **the** error class the map exists to
prevent, whitelisted inside its own guard.

**The sibling check never had this bug, and the difference is one line.**
`scripts/check-claude-md-paths.js` uses the same string only to build an error *hint* —
`-> moved to packages/shared/src/…` — and fails anyway. That is the right shape: it makes the
failure actionable without accepting it. The index check now does the same, so a wrong path both
fails and tells you where the file went.

## What shipped

- **108 path corrections**, applied programmatically and each verified with `existsSync` against
  both the old and the new location — nothing was renamed on a guess.
- **The fallback deleted** from `resolves()`, with the reason recorded beside the deletion.
- **The hint added**, ported from `check-claude-md-paths.js`.
- `scripts/__tests__/index-doc-paths-no-shared-fallback.test.ts` — four cases pinning that the
  fallback is gone from `resolves()`, that `packages/shared` appears nowhere in that function, that
  the reason survives with it, and that the failure message **does** still name the moved location.

**The test's first version was wrong, and its own failure said how.** It asserted over the whole
file, so adding the hint turned it red — which would have argued for dropping the hint rather than
the fallback, exactly backwards. Scoping the two prohibitions to `resolves()` and adding a fourth
case that *requires* the string in the error message is what encodes the real rule: **where** it
appears is the whole distinction.

That last one is the point of the test. Restoring the fallback makes the check **pass more**, which
is the direction nobody investigates, and a shorter list with no explanation reads as an oversight
somebody would helpfully "fix".

## Verification

- `check-index-doc-paths` — **963 paths across 12 orientation docs**, all exist, with the fallback
  gone.
- `check-module-map-symbols` — 163 `path → symbol` claims still resolve after the rewrite, which is
  what says the corrections landed on the right files rather than merely on existing ones.
- `pnpm check:rules` — Ran 62 of 62. Full suite green.
- **3 mutations, all caught**: restoring the fallback, deleting the reason, and reverting one
  corrected path to `lib/`.

**Nothing user-visible; no version bump.** Docs and one CI script.

**A note on the 🟢 row this does not contradict.** `projectOverview.md` records the module map's
`path → symbol` claims as holding, 110 of 110. That check
(`check-module-map-symbols.js`) verifies a symbol is attributed to the right *file*; it never
verified the file was in the right *directory*. Both were true at once.
