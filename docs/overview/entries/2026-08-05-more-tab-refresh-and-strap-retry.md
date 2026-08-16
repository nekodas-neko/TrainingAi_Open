# 2026-08-05 — Two owner-reported faults: a tab that never refreshed, and a strap that gave up

**Domain:** app-shell · devices — v1.257.0, JS-only (no APK rebuild)

The owner reported one symptom twice: *"I had to restart app for it to show as connected … I find
there are a lot of screens like that - that wont paint till an app restart happens."* It turned out
to be **two independent faults** that happen to present identically, and only one of them is a
paint problem.

## Fault 1 — the More tab genuinely never refreshed

All five bottom tabs stay permanently mounted in `components/shell/tab-shell.tsx` (a visibility
flip, not an unmount) — which is what makes tab switching instant. The consequence is that any
`useEffect(…, [])` in a tab runs **once per app launch**.

The persistent-tab-shell plan knew this and gave every tab an `epoch` that increments on re-show,
with a section on threading it through each screen's refresh pass. That section covered
Home, Health, Workout and Nutrition. **It never covered More** — `grep -n useTabVisibility` returns
four call sites, and the fifth tab is not among them.

So More fetched its data once and then showed that snapshot forever:

| what | source |
|---|---|
| profile, stats, equipped title | `/api/user/profile`, behind a module-level `if (_user) return` |
| season badges | `/api/seasons` |
| friends list / feed / leaderboard | `/api/friends*` |
| ring battery + last-sync age | `/api/oura/token` |
| outbox depth + failed mutations | local store |
| new-APK-available card | `/api/version` |
| scale + strap pairing rows | plugin + local state |

Ring battery and last-sync age are wrong within minutes. The update card exists specifically to
notice a build published while the app was open, and could not.

Fixed with one shared primitive rather than ten bespoke edits — `useRefreshOnTabShow(fn)` in
`components/shell/tab-visibility.tsx`, which runs `fn` on every epoch change and never on first
mount (the component's own mount effect already covers that). `useTabVisibility()` is a React
context, so leaf cards call it directly — no prop threading. The Oura card's refresh passes
`silent: true`, because its loading branch replaces the whole card and flashing a spinner on every
tab switch would be worse than the staleness.

### Verified in a browser, not asserted

Headless Chromium at 412×915 against `pnpm dev`, tapping Home ↔ More ↔ Health, logging every
watched response tagged by phase:

```
more#1: /api/oura/token  /api/friends/feed  /api/friends              ← first show
more#2: /api/user/profile  /api/seasons  /api/friends/feed  /api/friends  /api/oura/token
more#3: /api/user/profile  /api/seasons  /api/friends/feed  /api/friends  /api/oura/token
```

`more#1` correctly fetches nothing for profile/seasons — the module cache was already warm from the
page load, and epoch 0 means the re-show hook stays quiet. `more#2` and `more#3` are the fix: before
this change both were empty. No page errors.

## Fault 2 — the strap was not stale, it was dead

The pairing card was telling the truth. It already polls `getChestStrapLinkStatus()` at 1 Hz, so
"Not connected" was accurate — the connection really was gone, and a restart was the only revival.

Both strap paths give up by design:

- **Native (the APK path):** `PolarStrapService.kt` runs a 6-step ladder (2s → 120s, ~4 min) and
  then calls `stopSelf()`. Its comment reasons that an unreachable strap usually just isn't being
  worn — correct, since the H10 only advertises with skin contact — and ends *"JS restarts it on
  the next app open."*
- **WebView fallback:** `RECONNECT_DELAYS_MS = [2s, 5s, 10s]`, then `onDisconnected` returns.

**Nothing restarted it.** `startAmbient()` opens with `if (ambientWanted) return`, and
`LiveHrAmbientProvider` calls it from a `useEffect(…, [])` that runs once. Once ambient was on,
there was no expressible way to say "try again" — even starting a workout was a no-op, because
`ChestStrapSource.start()` opened with `if (this.started) return`.

Three changes:

1. `retry()` on the `LiveHrSource` contract — re-arm in place, never tear down and restart. Native:
   `ensurePermissions()` + `startService()` unless already ready/connecting. Fallback: reset the
   attempt counter and reconnect unless the GATT link is up.
2. `retryAmbient()` on the manager, which is the thing `startAmbient()` structurally could not be.
   It reconciles only when a wanted ambient source isn't started (so a `start()` that threw on
   "bluetooth off" is recoverable, and the tick doesn't fire a `setAmbient` bridge call every
   minute for nothing).
3. `start()` now falls through to `retry()` instead of returning inert, so a workout starting
   re-arms the strap.

Driven from `LiveHrAmbientProvider` by a **60 s tick gated on `document.visibilityState`**, plus
`visibilitychange`, plus the More tab re-show, plus a workout starting. Cheap by construction: the
native service ignores a start command while it already holds a client, and `retry()` exits
immediately while connected — so once the strap IS connected every tick is a no-op. It only does
real work in exactly the state the owner hit.

Also fixed alongside: pairing a strap now calls `startAmbient()` immediately (it previously sat
idle until the next app start), and forgetting one calls `stopAmbient()`.

## What is not verified

**Fault 2 is not device-verified and cannot be here.** Every path is BLE and native; the sandbox
has no radio and `getPolarBle()` returns null off-device. Seven unit tests cover the manager's
decision logic — ambient-only, never the ring, inert unpaired, survives a throwing source, no
redundant reconcile — and they prove nothing about whether an H10 actually reconnects. The
`projectOverview.md` Known-Issues row carries the on-device check to run: leave the app open with
the strap off for 5+ minutes so the service exhausts its ladder, then put the strap on and watch
the card flip **without a restart**, within ~60 s. Worth watching battery over a day with the strap
deliberately off, too — the tick is free while connected, but while disconnected it restarts the
ladder roughly continuously.
