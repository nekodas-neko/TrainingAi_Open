## 2026-07-20 — WebView zoom lock: stop the app reopening zoomed in

**Branch:** `claude/workout-screen-loading-jank-l5efu6` · **Version:** 1.185.2 (patch)

### Problem (user report, with screenshot)
"Every now and then when I minimize the app and reopen it, it opens in this zoomed-in view that
can't be fixed till it's reopened." — the workout screen (and any screen) would come back at a
zoomed scale and stay stuck there until the app was fully relaunched.

### Root cause
`app/layout.tsx`'s `export const viewport` set `width=device-width, initial-scale=1` but **did not
disable user scaling** (no `maximum-scale` / `user-scalable=no`). The Android WebView therefore
allowed pinch- and double-tap-zoom. Those gestures are easy to trigger accidentally during the
app-switch/minimize gesture, and the WebView **retains the layout-viewport scale across
minimize→reopen** — it only resets when the WebView is destroyed on a full relaunch. Hence
"zoomed in until reopened".

### Fix
Added `maximumScale: 1` and `userScalable: false` to the viewport export, so the served
`<meta name="viewport">` becomes
`width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover, user-scalable=no`.
With user scaling disabled the view can never get stuck zoomed. The app is a fixed-layout,
native-feel WebView (not a scrollable document), so locking zoom matches the intended UX.

**Ships via Railway, no APK rebuild** — the APK loads the remote Railway URL (`capacitor.config.ts`
`server.url`), so the change is in the served HTML `<head>` and takes effect on the next WebView load.

### Verification
- `tsc --noEmit` clean.
- Local `pnpm dev`: confirmed the served HTML on `/`, `/login`, and `/workout` now emits
  `...maximum-scale=1, ... user-scalable=no`.

### Not exercised
- **The zoom behaviour itself is only reproducible/verifiable on the Android WebView (S25 APK)** —
  the web/dev sandbox always renders at scale 1 and cannot reproduce the stuck-zoom state. The fix
  is the standard, well-understood viewport lock; **needs an on-device confirmation** that
  minimize→reopen no longer reopens zoomed. No offline-first/native-plugin/safe-area surface was
  touched.
