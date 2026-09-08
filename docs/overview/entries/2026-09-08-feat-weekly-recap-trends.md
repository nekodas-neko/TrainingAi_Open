## 2026-09-08 — The weekly recap stops vanishing when it fails, and Q-112e is split (LB-64)

**Branch:** `feat/weekly-recap-trends` · **Lane B**

### What Q-112e turned out to be

Q-112e says the weekly recap "gets the pattern Q-112a–d proves out, at the owner's *monthly scale*
lookback". Re-verifying it against `main` before building — the standing rule — found the trends half
**cannot be built from Lane B at all**, and the entry is now split rather than half-implemented.

`/api/weekly-digest` assembles a rich weekly picture (volume and its week-over-week change, weighted
sets per muscle, body metrics, sleep, Oura rows, derived scores, PRs) and spends **all of it on the
model's prompt**, returning `{ digest, weekStart }`. The numbers are computed and thrown away. Its
lookback is also **14 days**, not a month, and `/api/day-review/week-window` is fixed at 8 points by
construction — so nothing in the app serves a monthly series and no parameter gets you one.

Filed as **LB-64** (`Lane: A`), with the choice written out: return what `weekly-digest` already
computed, or a sibling window route as Q-112c is for the day. Recommended the sibling route, because
welding a chart series onto a rate-limited POST that runs an LLM gives the chart the prose's cache —
and the route's own source says the digest is deliberately re-derived when a late ring back-fill
moves its inputs. Q-112e now `Needs: LB-64` and keeps a `Keep:` naming exactly what is left.

### What shipped

The half that needed nothing from the engine, and that the plan asks for by name (it prescribes this
same fix for the daily digest under Q-112a): **the banner no longer vanishes when the recap fails.**

`weekly-recap-banner.tsx` returned `null` on error, so a user could not tell a quiet week from a
broken one. It is worse than the usual Q-499 shape because the fetch runs **once per completed week**
behind a `hasFetched` ref — a single failure cost the whole week's recap with nothing on screen. It
now says "Your week in review didn't load", offers "Tap to try again", and the tap re-runs the fetch
rather than requiring an app relaunch.

### Verification

- **One e2e case**, added to `card-429-error-state.spec.ts` beside the four cards of the same class:
  force `/api/weekly-digest` to 429 and assert the banner appears with its retry. **Mutation-checked**
  — restoring the old `|| error` guard fails it.
- `pnpm check:rules` — **Ran 70 of 70** · `tsc --noEmit` clean · `pnpm build` exit 0 ·
  `check-test-typecheck` at baseline · unit suite green · lint 0 errors.

### One wrong turn worth recording

The e2e first went to `/session-select` and found no banner, no request and no localStorage — which
briefly looked like evidence that `SessionSelectContent` was dead code. It is not: `/session-select`
**redirects to `/workout`**, and the component is rendered by `components/shell/tab-shell.tsx` on the
**Home tab at `/`**. A grep scoped to `app/` missed the importer in `components/`. Against `/` the
POST fires and the banner renders. The failing-then-passing pair is also what proves the new test
is not vacuous.

**Not exercised:** the APK. WebView surface, carried by a Railway deploy with no rebuild, but
confirmed at the S25 viewport rather than on the S25. The retry was driven by a forced 429, not by a
real model failure.

Patch bump — user-visible copy and behaviour.
