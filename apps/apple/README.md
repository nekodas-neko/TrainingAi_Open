# Apple client

Standalone Expo / React Native iPhone client in `TrainingAi_Open/apps/apple`. This project owns its dependencies, lockfile, app configuration, build scripts and tests. The repository root remains the Next.js backend and Capacitor Android client.

Implementation scope and checklist: [Native App Implementation Plan](https://chatgpt.com/space/page_580c9ed4236881919f92daccfd908684).

## Structure

| Directory | Responsibility |
| --- | --- |
| `src/app` | App composition, providers and navigation. |
| `src/features/account` | Backend sign-in API, session lifecycle and account UI. |
| `src/features/home` | Today screen; future home dashboard. |
| `src/features/health` | Health models, interval calculations and reading state. |
| `src/features/settings` | Settings screen and account controls. |
| `src/features/workouts`, `programs` | Reserved for the first workout flow and training programs. |
| `src/features/activities`, `progress` | Reserved for cardio, activity history and progress. |
| `src/features/nutrition`, `meal-plans` | Reserved for food logging, nutrition goals and meal plans. |
| `src/features/coach`, `social`, `devices` | Reserved for coaching, community/rewards and device integrations. |
| `src/integrations/auth` | iOS keychain, browser callback and native Apple sign-in adapters. |
| `src/integrations/apple-health` | iOS HealthKit queries and source inspection. |
| `src/core/storage`, `sync` | Reserved for account-scoped local storage and backend synchronization. |
| `src/shared` | Shared native UI and system appearance. |
| `src/development/diagnostics` | Opt-in local development reports. |
| `tests` | Centralized pure logic and API/session tests. |

Reserved directories contain `.gitkeep` files only. Storage, sync and the remaining feature implementations are not built yet. Sleep, readiness and body measurements belong to health; history and reviews belong to progress. Notifications and background work should get their own platform adapters when their first feature needs them.

Features own their logic and state. App composition connects providers and screens. Native services live behind platform adapters, with `.ios` implementations and unavailable fallbacks. Reusable code belongs in `shared`; do not import the backend's Next.js pages, server modules or root dependencies into this app. Any future shared package needs an explicit dependency and must be native-compatible.

## Local development

Run commands **from this directory**:

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm dev:status
pnpm dev:stop
```

On Windows, `Start Development.cmd` and `Stop Development.cmd` run the same managed launcher. It starts Metro on port 8088 and the local report receiver on port 8090, detects the private LAN address and maintains `.env.local`. The iPhone and PC must share a network. Open the installed development client and connect to the launcher URL.

Browser Google/email sign-in, account verification, native Apple sign-in/linking and Apple Health queries have been carried across from the prototype. Device verification of this refactor is still needed. The three existing Today/Data/Settings screens and system appearance remain. Expo Go supports previews; native account and HealthKit access require the signed iPhone development build.

```powershell
pnpm typecheck
pnpm test
pnpm exec expo export --platform ios --output-dir dist
```

The Apple CI workflow runs these checks independently. Backend TypeScript, ESLint and Vitest exclude this directory. Its nested `pnpm-workspace.yaml` keeps the app's React and native dependencies separate from the root workspace.

## Native builds and privacy

`pnpm build:ios` runs the Windows EAS launcher with this app as its project root. Apple credentials and two-factor codes are entered by the user in their terminal. Keep the registered bundle ID and scheme `com.fitnessai.training`, Expo project `meowi/trainingai-mobile` and existing EAS project ID. Moving source files requires no new signing identity or app installation.

`.env.local`, `.expo` reports/logs and signing credentials are ignored and excluded from EAS uploads. Development reports are opt-in and stay on the PC. Signing in does not upload health readings. Missing or denied health metrics remain unavailable and retain their source information.

## Reference baseline

The implementation plan is based on backend `main` at `e3c692f9a58fc27c90cf0737fb65de7f69515dae` (v1.489.0), tagged locally as `native-app-baseline-2026-10-10`. The structure branch is `feat/native-app-structure`. Compare that fixed commit with the current `origin/main` for the later feature-drift audit; the tag has not been pushed.
