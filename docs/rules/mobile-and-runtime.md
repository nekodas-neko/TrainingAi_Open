# Mobile UI and the canonical runtime

> Moved verbatim from `CLAUDE.md` on 2026-10-05, when it was cut from 121 KB to the short form (release train, Phase 4). `CLAUDE.md` keeps each rule as one line pointing here; **this file keeps the reasons and the incidents behind them**, which is what makes a rule hold. Some passages describe the retired seven-agent process (lanes, batons, the backlog file) — where they do, the rule they carry still stands and the mechanism around it is history.

## Mobile UI & Performance (S25 Ultra — the only real target)

Full rules (safe-area floored-utility clearance, instant-paint cache seeding, save-feels-instant,
render/memo discipline, touch & gesture direction-locking, dark-only theming, Zustand rehydration
safety, Android WebView compositor gotchas) moved to
[`docs/mobile-ui-and-performance.md`](../mobile-ui-and-performance.md) — the `ui-ux-pro-max`
skill enforces it directly for any screen/component work. The three costliest recurring mistakes,
kept here because they're cheap to state and expensive to relearn:
- **Bare `pb-safe`/`env(safe-area-inset-bottom)` gives near-zero clearance on Android gesture-nav**
  — any bottom-anchored action row/button uses a FLOORED utility (`pb-safe-action` /
  `pb-safe-action-lg`), never bare `pb-safe`, or it sits on the gesture bar.
- **A skeleton flash on a repeat visit is a bug** — seed every fetch synchronously from cache
  (`readCacheSync`) in a `useEffect` (never a `useState` initializer) and revalidate in the
  background.
- **`React.memo` only works with stable props** — one inline arrow/object literal at the call site
  defeats it silently while the component still reads as optimised.

## Canonical Runtime — the S25 APK is the only supported product target

**Policy:** the app's single canonical, supported runtime is the APK on the Samsung S25 Ultra. The
web build exists solely as a dev/QA surface (`pnpm dev` pre-merge testing) and must stay logic-free
(pure fetch → render pass-through, no defaults/derivations/write semantics the device path lacks).
**When behaviour must diverge, the device wins** — never add web-only product features. Full
signing/release mechanics, the local Gradle build fallback, and — most importantly — the
uninstall/ring-key recovery warning (an uninstall destroys the Oura ring's BLE key, which is **not**
recoverable from this repo, the server, or any log) now live in
[`docs/canonical-runtime-android.md`](../canonical-runtime-android.md) — **read it before any
uninstall, and before touching `android/**`, `capacitor.config.ts`, or cutting a release.**

**Most changes need no APK at all.** The APK is a WebView loading the app from Railway
(`capacitor.config.ts` `server.url`), so JS/TypeScript/server changes under `lib/`, `app/`,
`components/`, `packages/` reach the device through a normal Railway deploy — merging *is* the
delivery. Only `android/**` (Kotlin), `capacitor.config.ts`, or a dependency change needs a new
APK; when one does, download the CI-published rolling release (see the doc) rather than building
locally.

**Green `pnpm dev` is necessary, never sufficient.** For any change touching an offline-first
domain, a native plugin, safe-area, gestures, or notifications, the merge gate is the on-device
smoke run (`docs/device-smoke-checklist.md`) — or, when no device is available in-session, an
explicit Known-Issues row in `docs/overview/known-issues.md` marking the change NOT verified on device.
