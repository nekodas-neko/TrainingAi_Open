## Oura BLE Task 4 merge, Phase 3 doc corrections, and opening an architecture question

Merged PR #953 (Oura BLE Phase 1 Task 4 — on-device `(ringDs↔utc)` clock anchor), rebasing it
twice across concurrent merges (once onto the #962 production revert, once onto an unrelated PR
#963) and dropping a stale commit whose doc-comment fix only made sense under the now-reverted
#952 workspace split. Merged PR #964 (docs-only): noted that Phase 3 (bundling the shell into the
APK) removes today's zero-rebuild Railway UI-deploy path with no OTA/hot-swap replacement, and
corrected a stale Q-1 backlog line that read as if the app split simply "remains" untouched rather
than having been attempted, broken production, and been reverted.

The larger event this session: after watching #952 break production, the owner asked whether
Next.js+Capacitor is the right architecture at all for this app — single-user, Android-only,
sideloaded, already committed to an offline-first destination — and floated a from-scratch native
rewrite (Kotlin + Jetpack Compose + Room + WorkManager) on a new repo. This session gave a
stress-test-me opinion favoring that rewrite, reasoning from the app's single-platform target, the
sunk cost of the already-native Oura BLE Kotlin work, and a class of WebView-specific pain already
documented in CLAUDE.md — but explicitly did not decide anything, did not touch code toward it, and
did not check the opinion against the owner's own pre-existing
`docs/offline-first-target-architecture.md` (which frames the destination entirely within the
current stack). Wrote up the full reasoning and a ready-to-run research prompt for a follow-up
session in `docs/handoff-2026-08-02-platform-offline-architecture-review.md`, since the prompt had
only existed in chat until now.

## Verified

- `pnpm typecheck` clean on PR #953's branch after each rebase (twice).
- CI green on both merged PRs (#953: Lint, Tests, Build, Custom Rules, Migration Check, Android
  Kotlin+APK build; #964: docs-only, same non-Android checks).

## Not verified

- **PR #953's clock anchor, on-device.** No Robolectric coverage for the SQLite path in this
  project; `measured_at` correctness against a real drain needs an owner S25 pass before D2 Task 5
  (the on-device rollup port) consumes it.
- The architecture-rewrite opinion itself — no research was run, no scope was measured against the
  actual codebase size, nothing was validated beyond one session's reasoning in chat.
- `pnpm dev` was not run this session — no application code changed, only Kotlin doc comments
  (net zero after a dropped commit) and Markdown.
