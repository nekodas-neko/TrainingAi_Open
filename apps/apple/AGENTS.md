# Apple client

This directory is an independent Expo iPhone project. Use its own `pnpm-workspace.yaml`, package manifest and lockfile; run app commands here, never at the repository root. The backend's Next.js and Capacitor conventions apply to their own code. Read this README and the implementation plan before adding native features.

Keep feature logic in `src/features`, iOS adapters in `src/integrations`, app composition in `src/app`, shared UI in `src/shared` and future storage/sync infrastructure in `src/core`. Use centralized `tests`. Preserve the plain iOS system appearance and existing bundle ID, callback scheme and secure-storage keys.

Apple Health spans contributing sources. Preserve provenance, do not turn absent/denied metrics into zero and do not double-count overlapping samples.

Do not stage, unstage, commit, reset, stash or push without explicit user instruction. Do not use `codex/` branch names. Never reply to GitHub comments for the user. Keep comments short and avoid unnecessary documentation or tests.

Local `.env` settings and `.expo` diagnostic reports must not be committed, printed or uploaded. Reports are opt-in. EAS uploads must be rooted at this directory using `pnpm build:ios`; the user enters Apple credentials themselves.
