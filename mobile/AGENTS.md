# Mobile client

This directory is an independent Expo iOS and Android project. Use its own `pnpm-workspace.yaml`, package manifest and lockfile; run app commands here, never at the repository root. The backend's Next.js and Capacitor conventions apply to their own code. Read the README, [`docs/remaining-work.md`](docs/remaining-work.md) and the root [`docs/native-testing.md`](../docs/native-testing.md) before adding native features.

The root [`CLAUDE.md`](../CLAUDE.md) governs this directory too: how work flows (issues, batches, PRs, branch names, commit messages, releases), the module map and the shared domain math in `packages/shared/`, the date and time rules (`todayInTz`, `formatTimeOfDay`), the AI, security and git-safety rules, and its working practices. Its web-only lines (`lib/cache-groups.ts`, `lib/local-store/`, Capacitor, `pb-safe-action`) do not apply here; the paragraphs below are the native equivalents. When bringing across an existing feature, inspect the original implementation first and match its screen layout, content hierarchy, navigation, interaction sequence and presentation of detail directly. Keep controls and unfinished destinations in their original positions; do not introduce overview dashboards or rearrange sections around the features implemented so far. Use reusable themed native components to reproduce the original composition. Adapt controls to native platform UI without redesigning the screen or replacing a guided flow with a long form. Any intentional departure should follow the user's direction.

Keep feature logic in `src/features`, platform adapters in `src/integrations`, app composition in `src/app`, shared UI in `src/shared` and future storage/sync infrastructure in `src/core`. Use centralized `tests`. Use the shared UI library and central theme tokens for all screens. Extend reusable components instead of duplicating controls or hard-coding visual values in feature screens. Preserve the existing bundle ID, callback scheme and secure-storage keys.

For cached data, show saved content immediately and refresh quietly when stale. Choose freshness per feature, share overlapping requests, back off after failures and invalidate affected data after successful writes. Manual refresh bypasses freshness and shows progress; routine background checks should not disrupt the screen. Keep authentication and permission checks independent of display-cache freshness.

Preserve expensive views when switching tabs, limit offscreen rendering and show placeholders during initial asset layout/loading. Check local rendering costs as well as network requests; raise confirmed backend limitations as issues when the user requests that.

Loading, refresh and saved-state indicators must not insert/remove rows that shift existing controls. Use reserved header space, fixed-size placeholders or overlays; keep errors and retry actions accessible.

Apple Health and Health Connect span contributing sources. Preserve provenance, do not turn absent/denied metrics into zero and do not double-count overlapping samples.

Commit, push and open PRs as the root `CLAUDE.md` says: a branch from a freshly fetched `main`, a PR with `Closes #N`, never a force-push, `--no-verify` or `reset --hard`. Do not use `codex/` branch names. Keep comments short. A change to logic comes with a test in `tests/`.

Local `.env` settings and `.expo` diagnostic reports must not be committed, printed or uploaded. Reports are opt-in. EAS uploads must be rooted at this directory using `pnpm build:ios` or `pnpm build:android`; the user enters Apple credentials themselves.
