# 2026-08-15 — "Restore from cloud" stops living under the version number (Q-232, step 2)

**Branch:** `claude/ia-cluster-app-shell` · **Version:** v1.310.0
**Plan:** [`2026-08-14-more-tab-information-architecture.md`](../../superpowers/plans/2026-08-14-more-tab-information-architecture.md) §2, step 2 of its build order.

One block on More → Profile held the app version, the update check, the service-worker status, the
APK download, the changelog — **and** Sync now, Restore from cloud, Export my data. All under a
heading that said *About*.

The plan calls this "the clearest single example of the owner's complaint", and it is the one part of
§2 that has to be **split** rather than moved: three data operations filed under a version number.
They are `/more/data` now; the rest is `/more/about`.

## Deviation from the plan's grouping, deliberately

§8 groups Settings, Data and About as one step. This PR does Data and About only.

They had to move together — they were one block, and splitting them is the point. **Settings is a
separate block that shares no state with either**, so bundling it would have made one PR that
touches ten preference toggles, two collapsibles and three sync handlers at once. It is step 3 now,
on its own. Nothing is left half-moved by stopping here: the About block is fully resolved into two
screens.

## What moved

- `components/more/data-sync-panel.tsx` — `handleSyncNow` and `handleRestore` moved with their own
  `syncing` / `restoring` state, which nothing else in `profile-tab.tsx` read. Comments preserved
  verbatim, including the one explaining why the sync failure toast surfaces the real error rather
  than a generic message (the no-silent-fallback rule).
- `components/more/about-panel.tsx` — version, `UpdateCheckCard`, `ServiceWorkerStatusRow`, APK link,
  changelog.
- `components/more/sub-screen.tsx` — the navless takeover shell (back chevron, centred title,
  `pb-safe-action-lg` scroll container), **extracted at its second copy** and now used by Devices,
  Data and About. `devices-content.tsx` was rewritten to use it.

`profile-tab.tsx` is **697** lines, down from 845 when this cluster started.

## The custom-rules check caught my comment

`check:rules` step 3, *No hand-rolled safe-area insets*, failed on `sub-screen.tsx` — because the
**comment** explaining why the utility is floored contained the raw inset expression. The grep does
not know prose from code, and that is the correct trade for a rule with this history. Reworded the
comment; did not touch the check.

## Verification

`npx tsc --noEmit` · `pnpm lint` (no new warnings; five imports that became unused were removed) ·
`pnpm build` (`/more/data` 7.53 kB and `/more/about` 5.1 kB in the route table) ·
**`pnpm check:rules` — Ran 35 of 35** · `check-component-size` and `check-hex-literals` clean ·
full suite **471 files / 3,899 tests green**.

`pnpm dev` at 412×915 as `test@local.dev`:

- More shows **Data & Sync** and **TrainingAI v1.309.0** rows, and **no** inline Restore / Export /
  What's-new.
- Each row navigates to its screen and Back returns to `/more`.
- `/more/about` renders version, SW status, APK link and the changelog.
- **The moved handler was actually run, not just rendered:** tapping *Sync now* produced
  `Cache cleared — data will refresh automatically` within 400 ms — the web branch of `handleSyncNow`,
  which is the one reachable here.
- Zero console errors throughout.

**⚠️ Not device-verified.** Two things only the S25 can show: the `pb-safe-action-lg` clearance on
three navless screens, and the *native* branches of both moved handlers — `pullDelta` and
`restoreFromCloud` both return `null` without SQLite, so the sandbox exercises only the fallback
path. Restore in particular has never run here at all.
