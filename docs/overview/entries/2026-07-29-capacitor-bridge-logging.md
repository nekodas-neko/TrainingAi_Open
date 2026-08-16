## 2026-07-29 — 16% of the main thread was Capacitor logging plugin traffic nobody reads

Third finding pulled out of the owner's 2026-07-29 S25 profile (the one taken with the dynamic
wallpaper already disabled). After Recalculate style at 21.9%, the next-largest entry was:

| Activity | Self time | Share |
|---|---|---|
| `(anonymous)` **VM11:322:48** | **1,596.5 ms** | **16.4%** |
| `win.androidBridge.onmessage` **VM11:935:56** | 151.7 ms | 18.1% *total* |

Two entries in the same `VM11` script, which is the giveaway: `VM11` is an injected script, and
`win.androidBridge` is Capacitor's native bridge. `VM11` is
`@capacitor/android@8.3.4`'s `native-bridge.js`.

### What line 322 is

```js
// native-bridge.js:318 — the returned (result) => {…} is what the profile names
const createLogFromNative = (c) => (result) => {
    if (isFullConsole(c)) {
        …
        c.groupCollapsed('%cresult %c' + result.pluginId + '.' + result.methodName + …);
        c.dir(JSON.stringify(result.data));      // ← every plugin result, stringified
        c.groupEnd();
    }
```

and it is reached from both directions on every single plugin call:

```js
// :914  outbound
if (cap.isLoggingEnabled && pluginName !== 'Console') cap.logToNative(callData);
// :943  inbound
if (cap.isLoggingEnabled && result.pluginId !== 'Console') cap.logFromNative(result);
```

So **every `CapacitorSQLite.query` result set gets `JSON.stringify`d on the main thread**, then
written into three console calls — whether or not DevTools is attached. This is the same thing as
the long-standing unqueued note under Q-1: *"the console emits hundreds of `CapacitorSQLite.query`
calls in a burst on screen load."* That was never the app logging. It was this.

### Why it was on

`CapConfig.java:292` — `loggingBehavior` defaults to `"debug"`, and the `debug` branch is
`loggingEnabled = isDebug`. The APK is built with `./gradlew assembleDebug`, so it was on, always.

### Change

Both halves, because they land at different times:

1. **`capacitor.config.ts` → `android.loggingBehavior: 'none'`.** The correct fix, at the source.
   Takes effect on the **next APK rebuild** (`npx cap sync android && ./gradlew assembleDebug`).
2. **`components/capacitor-native-init.tsx` clears `window.Capacitor.isLoggingEnabled` at module
   scope.** Both check sites read that property off the live global on every call, so this turns the
   same logging off on the APK **already installed**, shipped through Railway with no rebuild. Module
   scope rather than an effect, because plugin traffic starts before effects run.

### What this does not break

- **The Kotlin plugins keep logging.** Oura BLE, scale BLE, and the rest use `android.util.Log`
  directly, not `com.getcapacitor.Logger` (which is the thing gated on this flag) — checked across
  `android/app/src/main/java`. Logcat debugging of the BLE work is unaffected.
- **Remote DevTools still works.** That is `webContentsDebuggingEnabled`, a separate config key.

What is lost is the collapsed `native …` / `result …` console groups mirroring plugin traffic.

### Verification

`pnpm tsc --noEmit` clean, `pnpm lint` 0 errors (119 pre-existing warnings).

Browser-verified in Chromium with an init script standing in for the WebView
(`window.Capacitor = { DEBUG: true, isLoggingEnabled: true, Plugins: {} }` installed before any page
script, matching what `JSExport.getGlobalJS` emits):

```
with the change   : isLoggingEnabled now: false   PASS
against main      : isLoggingEnabled now: true    FAIL
```

The probe was confirmed to fail against unmodified `main` before it was trusted.

**Not verified on device, and half of it cannot be.** The config half needs an APK rebuild — no
Android SDK in the sandbox. Whether 16.4% actually comes off the main thread is the owner's
re-profile to make. The mechanism is proven; the magnitude is not.

### Still open from the same profile

- **CLS** read **0** in this profile, not the 0.14 recorded from an earlier one. The backlog note
  under Q-1 is corrected accordingly — it is not a stable finding.
- The Frames track showed individual frames of **2,430 ms / 2,197 ms / 3,478 ms**. Those are almost
  certainly a tab's first activation (dynamic chunk fetch + full first render of that tab), not
  anything steady-state. Unqueued.
