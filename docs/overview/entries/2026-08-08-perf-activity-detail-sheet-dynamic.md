## 2026-08-08 — activity charts load dynamically; Q-127's cold-start claim did not reproduce

**Branch:** `perf/activity-detail-sheet-dynamic` · **Domain:** `app-shell`

> **Where the code actually landed:** the two-file change described below shipped inside
> **#1140 (Q-119)**, not this PR. It was uncommitted on this branch when I switched to the Q-119
> branch to resolve a version conflict; git carried the working tree across and a `git add -A`
> swept it into that commit. Both files were reviewed and CI-green either way, so nothing unsound
> merged — but `git log` attributes them to the brand-token PR. This PR is therefore **docs-only**:
> the journal entry, the `projectOverview.md` note, and the backlog-entry removal.
> **The lesson, for whoever hits this next:** commit before switching branches, and check
> `git status` after a checkout that reported carrying changes. This happened twice in one session.

### What Q-127 claimed

That `app/health/health-content.tsx`'s `dynamic(..., { ssr: false })` wrapper around
`ActivityDetailSheet` was *"fully bypassed"* by a static chain — `health-content.tsx` →
`health-sections.tsx` → `activity-history-card.tsx` → `activity-detail-sheet.tsx` →
`PaceBarChart` / `ElevationProfileChart` / `ZoneDonutChart` — landing chart.js (~208 KB) plus
`react-chartjs-2` in the Health tab chunk that `tab-shell.tsx` `requestIdleCallback`-warms on
every app open. The stated consequence: *"a user who only ever looks at Home downloads and
evaluates chart.js on every cold start."*

### What measurement showed

**The chain is real. The consequence is not.** Two production builds, before and after the change:

| | before | after |
|---|---|---|
| `/health` initial chunks | 28 | 28 |
| `/health` initial chunk bytes | 1040 KB | 1040 KB |
| chart.js in those chunks | none | none |
| `PaceBarChart` in those chunks | none | none |
| `ActivityHistoryCard` in those chunks | none | none |
| total `static/chunks` bytes | 6,649,421 | 6,652,873 |

Chart.js already lived in its own on-demand chunk (`a94babcc…`, 157 KB) and the sheet plus its
charts in another (`9727…`, 189 KB), neither reachable from any page's initial chunk list in
`app-build-manifest.json`. Webpack was already isolating the whole subtree behind
`health-content.tsx`'s own `dynamic()` boundary, so the static import below it never pulled
anything onto the cold path. The +3.4 KB is the extra `dynamic()` wrappers.

Per CLAUDE.md's *re-verify the plan against current `main`* rule, that makes the performance
premise stale rather than the item wrong — the inconsistency it spotted is genuine.

### What shipped

The narrow, verifiable half only:

- `activity-detail-sheet.tsx` loaded three of its six charts through `dynamic()` and three
  statically. All six now go through `dynamic(..., { ssr: false })`.
- `activity-history-card.tsx` imported the sheet statically while `health-content.tsx` imported the
  same component dynamically. Both now match.

The intent is that the split is **stated** rather than inferred from bundler chunking heuristics,
which can shift under a Next/webpack upgrade without anyone noticing.

**Deliberately not shipped:** a first-tap mount gate (`{sheetMounted && <ActivityDetailSheet/>}`)
that would defer the sheet's chunk request from tab mount to first open. It was written, then
dropped — the measurement above shows the chunk is not requested on tab mount anyway, so it bought
nothing observable in exchange for extra state on two screens.

### Verification

- `tsc --noEmit` clean · `pnpm lint` 0 errors · `vitest run` — full suite green except the known
  seeded-local-DB failure in `scale-ble-multi-reading.test.ts` (filed by me as Q-141 — a number already claimed by open PR #1143; correctly refiled as **Q-146**, and since fixed by #1160).
- Two full `pnpm build` runs, before and after, compared through `app-build-manifest.json` and
  by grepping every emitted chunk for chart.js internals (`radialLinear`, `_metasets`) and for
  component-unique strings (`Fastest 1km`, `Activities This Week`).

### Not exercised

No device run — import wiring only, no native, safe-area, gesture or notification path. **The
activity detail sheet itself was not opened in a browser after the change** — a runtime check was
attempted but `next start` in this sandbox has no `SESSION_SECRET`, so login fails with
`error=Configuration` and only the signed-out page is reachable. The change is import-shape only
and typechecks, but the sheet rendering its six charts through the new dynamic wrappers is
**unverified at runtime** and is the thing to look at first if anything is wrong. Bundle figures
come from build artefacts, not from a device or a throttled network profile.
