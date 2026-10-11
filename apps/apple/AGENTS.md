# Apple client

This directory is an independent Expo iPhone project. Use its own `pnpm-workspace.yaml`, package manifest and lockfile; run app commands here, never at the repository root. The backend's Next.js and Capacitor conventions apply to their own code. Read this README and the implementation plan before adding native features.

The root project's `CLAUDE.md` does not govern this Apple client. When bringing across an existing feature, inspect the original implementation first and match its screen layout, content hierarchy, navigation, interaction sequence and presentation of detail directly. Keep controls and unfinished destinations in their original positions; do not introduce overview dashboards or rearrange sections around the features implemented so far. Use reusable themed native components to reproduce the original composition. Adapt controls to native iPhone UI without redesigning the screen or replacing a guided flow with a long form. Any intentional departure should follow the user's direction.

Keep feature logic in `src/features`, iOS adapters in `src/integrations`, app composition in `src/app`, shared UI in `src/shared` and future storage/sync infrastructure in `src/core`. Use centralized `tests`. Use the shared UI library and central theme tokens for all screens. Extend reusable components instead of duplicating controls or hard-coding visual values in feature screens. Preserve the existing bundle ID, callback scheme and secure-storage keys.

For cached data, show saved content immediately and refresh quietly when stale. Choose freshness per feature, share overlapping requests, back off after failures and invalidate affected data after successful writes. Manual refresh bypasses freshness and shows progress; routine background checks should not disrupt the screen. Keep authentication and permission checks independent of display-cache freshness.

Apple Health spans contributing sources. Preserve provenance, do not turn absent/denied metrics into zero and do not double-count overlapping samples.

Do not stage, unstage, commit, reset, stash or push without explicit user instruction. Do not use `codex/` branch names. Never reply to GitHub comments for the user. Keep comments short and avoid unnecessary documentation or tests.

Local `.env` settings and `.expo` diagnostic reports must not be committed, printed or uploaded. Reports are opt-in. EAS uploads must be rooted at this directory using `pnpm build:ios`; the user enters Apple credentials themselves.
