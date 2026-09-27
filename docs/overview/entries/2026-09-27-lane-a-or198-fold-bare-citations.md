# 2026-09-27 — OR-198: the journal fold now rewrites bare-path citations, and 51 broken ones are fixed

## The entry undercounted by a lot

OR-198 found **1 broken citation in 152**, measured in the one file it was relocating. Measured across
the repo, **79 of the 100 bare backticked citations of a journal entry pointed at a file the fold had
already moved.** `check-doc-links` reads only link targets, and `check-index-doc-paths` only the
orientation indexes, so nothing had ever seen them.

## What changed

- **`scripts/fold-journal-entries.js`** rewrites a bare `` `docs/overview/entries/x.md` `` to
  `` `docs/overview/<history-file>#x` `` in the same pass that moves the entry ("trap 7"). Verified
  with a real fold in a throwaway worktree: a planted citation, in prose and in a list, came out
  pointing at the history file with an anchor that exists. The existing link-rewrite path was
  unchanged.
- **`scripts/check-index-doc-paths.js`** drops a `#fragment` before checking that a path exists,
  so the fold's new citation form does not read as a missing file.
- **One-time repair of the backlog of breaks:** 51 citations rewritten in 31 files. 34 history-file
  entries that had only a `<!-- from: x.md -->` marker gained an `<a id="x">` anchor, so every
  repaired fragment resolves. A re-scan shows **76 resolving, 9 not**, and the 9 are not fixable
  citations:
  - `x.md` in `entries/README.md` is a template.
  - Four in two cardio plan docs are build instructions (`Create: …`); the entries were written
    under a `feat-` prefix.
  - **Four in `docs/doc-size-baseline-history.md` name entries that exist nowhere in the history
    archives** (`2026-08-26-fix-batch-upsert-duplicate-collapse`, `…-fix-daily-summary-replace-guard`,
    `…-feat-app-load-metrics`, `2026-09-09-admin-tool-routes-test`). They were deleted, not folded,
    and that file is a historical log, so they stay as written.

The repair itself was a scratch script and is not committed. It had a bug worth recording: its final
pass wrote the anchor-annotated history files back over the citation rewrites it had just made in
those same files. The re-scan caught it, which is why the re-scan exists.

## Not done

A checker that resolves every backticked `docs/**.md` path repo-wide, which the entry offered as the
alternative. With the fold fixed, the only way left to break one is deleting an entry by hand, which
is what produced the four above. It would need an allowlist for those nine from day one.
