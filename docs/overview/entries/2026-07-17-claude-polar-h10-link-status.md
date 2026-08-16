## Session 2026-07-17 — Strap link-status readout + H10 partial device verification recorded (v1.161.4)

Owner tested the H10 on the S25 (after the APK rebuild — first attempt failed because
`pnpm install` was skipped before `npx cap sync android`; the plugin copies from `node_modules`):
**pairing, battery/firmware readout, and live strap HR all confirmed working.** Then asked whether
the card saying just "Polar H10 1E416A33" meant a *permanent* connection — it doesn't (the app only
opens a BLE link while live-HR runs; battery/FW was a momentary pairing-time read; an unclipped H10
powers off entirely) — and requested a connected/disconnected readout.

Shipped (owner-requested in-session, exempt from the backlog protocol):
- `ChestStrapSource.linkStatus()` + module accessor `getChestStrapLinkStatus()` exposing the **raw
  GATT truth** (`gattConnected`/`worn`/`active`) — deliberately NOT the worn-gated
  `connectionState()` the manager sees, which under-reports for a trust readout (a linked-but-unworn
  strap must show "Connected · no chest contact", not "Not connected").
- The pairing card polls it at 1 Hz while mounted and shows a dot + label:
  "Not connected — connects automatically during workouts" / "Connecting…" /
  "Connected · on your chest" / "Connected · no chest contact (ring takes over)". Dot colour is
  paired with the label text (no colour-only state).
- Known-Issues row updated to record the owner's partial verification honestly (pairing + live HR
  ✅; fallback round-trip, workout-HRV row, and this new status line still to verify).

Gate: tsc clean, eslint clean (one `no-this-alias` hit reworked via a register function), live-hr
suite 33 green, `/more` 200 on the dev server. Patch bump **v1.161.4** (re-bumped on each rebase:
1.159.1 → … → 1.161.4 as parallel PRs #593–#597 took 1.160.x–1.161.x) + changelog. First entry written under
the #595 per-entry journal convention.
