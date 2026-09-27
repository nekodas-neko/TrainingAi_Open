# RV-200 item 3 — a model call that reworded a sentence already on the screen

**Branch:** `lane-a/rv200-ai-rewording` · **Lane A + B** · `[platform][cardio]`

One of RV-200's four. The owner's request is the product decision behind it: *"we use AI more than
we need to … use logic instead to save on tokens and offline compatibility."*

`POST /api/running-plan/explain` took the deterministic `rationale` the prescription already
carried, asked the model for a warmer sentence, and the card swapped it in when it arrived. The
route's own header called it "never load-bearing". The claim checked out exactly: `prescribed-run-card.tsx`
rendered `{aiMessage ?? rationale}`, so the user saw the deterministic text first and a reworded
version of the same thing a moment later.

Route, fetch effect, cache key module and its TTL are gone. The card renders `{rationale}`.

## Three things depended on it that the entry did not name

- **`lib/ai/degrade.ts` cited it as the reference implementation** for the whole degrade-don't-500
  pattern. Re-pointed at `ai/health-insight`, which the same comment already called "the second
  precedent, and the more exact one". The note now also says why this route stopped being a good
  reference: a route whose degraded answer is its own input never needed the model.
- **`ai-prose-routes-fail-safe.test.ts`** pinned its 200-with-rationale behaviour as one of two
  documented fail-safes. That block is removed and the header explains what happened to it.
- **`prose-guards.test.ts` carried `expect(prose.length).toBeGreaterThanOrEqual(7)`** — a tripwire
  against a scan that silently matches nothing. Now 6, with a note that it is a floor rather than a
  target.

## A gate failure worth remembering

`check-tab-navigation` died with `ENOENT` on the deleted route. Several checks enumerate source with
`git ls-files`, which lists what the index holds — so a file removed with `rm` but not staged is
still in the list and no longer on disk. **Stage a deletion before running the gate**, or the
failure names a file you have already deleted and reads as nonsense.

Deleting `.next` was also needed: its generated route types referenced the removed file and failed
`tsc`. Hand-editing the generated validator made it worse; removing the build cache is the fix.

## Verification

No new tests — this is a deletion, and the property that matters (the card shows the deterministic
rationale) was already true and is now the only path. The suites that covered the route are removed
or adjusted with their reasons.

Gates: `lint` 0 · `tsc` 0 · `typecheck:tests` 0 · `check:rules` 0 (79 of 79) · pointers 0 · full
suite **9,960 passed**.

## Not exercised

- **The card was not rendered.** The change is a deletion plus one JSX expression, typechecked, but
  nothing opened the Running screen — on the device or in a browser.
- **Offline behaviour is improved by construction rather than measured**: there is no fetch left to
  fail. The entry's "renders with the network off" bar is met for this surface in the sense that
  nothing network-dependent remains on it, which is not the same as having watched it offline.
- **Items 1, 2 and 4 of RV-200 are untouched and unverified.**
