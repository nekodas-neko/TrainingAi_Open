# Oura BLE — Feature-Enablement Playbook

**What this is:** the repeatable process for turning a ring capability we *don't* have yet
(live HR, steps, SpO₂ spot-check, …) into a working feature. Distilled from the live-HR
build (sessions 224→233), which is the worked example throughout. Read this before starting
any new "get X off the ring" work — most of them are the same shape.

> **Ground rule (from CLAUDE.md):** byte layouts come from the pinned RE sources
> (`open_oura` Rust, `open_ring` `PROTOCOL.md`, `ringverse/protocol`, the `oura-native-ble`
> skill) or from **captured real frames** — never from memory. A wrong byte reads as
> `undefined`/garbage and fails silently. Prove a non-null value lands before calling it done.

---

## The shape every ring feature has

A ring metric is a **feature** (must be enabled) that, once on, emits **event frames**
(tag ≥ `0x41`) into the ring's history, which the service already forwards to JS as
`ouraFrames`. So every feature is the same five-stage pipeline:

```
1. DIAGNOSE   — is data even arriving? which tags? (no code change / a read-only panel)
2. ENABLE     — send the feature's SetFeatureMode / trigger command (native → APK rebuild)
3. CAPTURE    — confirm the event frames now arrive (the diagnostic from stage 1)
4. DECODE     — turn the frame bytes into the number (port a known decoder, or crack it)
5. DISPLAY    — surface it (+ store it, + battery-gate the enable if it's costly)
```

The two hard stages are **2 (ENABLE)** and **4 (DECODE)**. Everything else is plumbing we
already have.

---

## The reusable assets (already built — don't rebuild)

| Asset | Where | What it gives you |
|---|---|---|
| Frame transport | `OuraRingService.onFrame` → `bufferFrame` → `ouraFrames` | **Every** frame (any tag) already reaches JS. You never need native changes to *see* a frame. |
| Command builder | `OuraProtocol.reqSetFeatureMode(id, mode)` = `2f 03 22 <id> <mode>` | Enable any feature. `reqSetRealtime` (`0x06`) for realtime streams. Add new sub-op writes next to it (the DHR burst's `0x26` is the template). |
| Generic lever | plugin `setFeatureMode({feature, mode})` + tester buttons | Sweep any feature×mode **on-device without a rebuild** once the plugin method exists. |
| Diagnostic panel | `components/workout/live-hr-readout.tsx` `DiagnosticsPanel` + `OuraRingSource` diag | Frames-seen / per-tag histogram / decode-hits / **copyable raw hexes**. Clone the pattern for any new metric. |
| Admin tester | `/admin/oura-ble` → Advanced | Per-tag frame counts + raw command buttons + log console. This is where you watch a tag light up. |
| Decoder home | `lib/oura-ble/decode.ts` | `parseHistoryEvent` strips the 4-byte deciseconds timestamp; add a per-tag `decodeX`. Infallible rule: unknown → `null`, never throw. |
| Live-value layer | `lib/live-hr/*` (source→manager→`useLiveHr`) | Source-agnostic streaming + recency guard + `measureNow`/`setForced`. Reuse for any live metric. |

---

## The five stages, with the live-HR example

### 1. DIAGNOSE — surface the raw signal before guessing
Ship a **read-only diagnostic** that answers "is anything arriving, and what?" *before*
writing any decoder. For live HR this was the on-card panel: `framesSeen`, a per-tag
histogram, `hrFramesSeen`, `decodeHits`, and **copyable hexes**. It turned a vague "no HR"
into a precise verdict tree:

- `framesSeen === 0` → nothing reaching JS (service/connection problem).
- frames arrive, but not the metric's tag → **feature not enabled** (stage 2).
- metric-tag frames arrive but `decodeHits === 0` → **decoder wrong** (stage 4).
- decoded > 0 → working.

**This is the highest-leverage stage.** It's cheap (JS-only, no rebuild), and it tells you
which of the two hard problems you actually have instead of guessing.

### 2. ENABLE — the feature is off until you turn it on
After a key-only re-key, only `DAYTIME_HR + SPO2 + RESTING_HR` run automatically. Everything
else (`REAL_STEPS 0x0b`, `EXERCISE_HR 0x03`, …) is **off** and emits **nothing** until an
explicit enable. The enable is one of:

- **Feature mode:** `SetFeatureMode(<id>, AUTOMATIC|CONNECTED_LIVE)` = `2f 03 22 <id> <mode>`.
- **A sub-mode / trigger write:** e.g. the DHR on-demand burst needed a *second* write on a
  **different sub-op** — `2f 03 26 02 02` (`0x26`, not `0x22`). This is the trap: the obvious
  `0x22` write *acked* but streamed nothing; the real "start" was the `0x26` sub-mode.

Enables are **native → require an owner APK rebuild** (`npx cap sync android &&
./gradlew assembleDebug`). Batch every candidate lever into one rebuild and expose each as an
isolation button in the tester, so the owner tests them all in one on-device session.

> **Live-HR lesson:** we spent a whole cycle on `CONNECTED_LIVE` + fast-HR (acks, zero HR)
> before finding the missing `0x26` in `open_ring`. When an enable *acks but produces no
> frames*, suspect a missing second write/sub-op, and go read the RE sources for the exact
> sequence rather than trying more feature-mode combos.

### 3. CAPTURE — confirm the tag now lights up
With the feature enabled, the metric's event tag should appear in the tester's per-tag counts
(and the diagnostic's histogram). For live HR: `0x80`/`0x60` (IBI) counts climbing was the
"it's working" signal. If the tag still doesn't appear after enabling, the enable is wrong
(back to stage 2) — don't move to decode.

### 4. DECODE — port it, or crack it from captured data
Two very different situations — **know which one you're in before starting:**

- **(a) A decoder exists in the RE sources → port it.** Live HR was this: `open_ring`'s
  `PROTOCOL.md` gave the exact IBI→BPM path, and our decoder already handled `0x80`/`0x60`.
  Zero cracking. Grounded, fast.
- **(b) No decoder exists → crack the field layout from captured frames.** This is the slow
  path. Enable the feature, do a **known quantity** of the activity (walk exactly N steps,
  hold a known HR), capture the tag's hexes via the diagnostic, and find the field whose value
  matches. Pin every finding to the captured vector as a unit test. Mark the decoder
  `_status:"unvalidated"` until a non-null value is proven end-to-end into the DB column.

Check which case you're in by reading the RE sources for the tag **first**. If they only *list*
the tag with no byte layout (as they do for steps `0x7e`/`0x7f`), you're in case (b).

### 5. DISPLAY — surface, store, and gate the cost
- Surface via the reusable live layer (`useLiveHr` pattern) or a card, with a recency/staleness
  guard so a stale value blanks instead of lying.
- Store it: decoded frames land in `oura_raw_samples` (archival, re-decodable) and graduate to
  `body_metrics`/etc. Never prune `body_hex` — a better decoder can back-fill by re-decoding.
- **Battery-gate anything that actively powers a sensor.** The DHR burst powers the PPG LEDs, so
  we drive it only during rest (`setForced`) — a metric that only records passively (like steps)
  doesn't need this.

---

## Verification discipline (non-negotiable)

- The whole path is **inert in the web sandbox** (`getOuraBle()` returns null). Kotlin can't
  compile in-sandbox (no Android SDK) — the Android CI job is the only compile gate; behaviour
  is **owner-rebuild + on-device** only.
- "Acks" ≠ "works." A command resolving tells you the ring accepted the *frame*, not that it
  *did* the thing. Only a decoded non-null value in the DB (or on the card) counts.
- Every enable is reversible — restore features to `AUTOMATIC`/off on stop.

---

## When you're stuck: the escalation order

1. Re-read the diagnostic — which stage's failure signature is it? (framesSeen / tag / decode)
2. Read the pinned RE sources for the exact tag/command (open_ring `PROTOCOL.md` first — it's
   from static decompilation of the official app, so it's the most complete; then open_oura Rust;
   then `ringverse/protocol`; then the skill). **Without another ring**, static-RE-of-the-app
   (what `open_ring` did) is the source of truth — you do not need a second ring or a traffic
   capture.
3. Only if the sources have the *tag but not the layout* do you crack it from captured data.
4. Never re-onboard the official Oura app to capture our own ring's traffic — it can force a
   firmware update that breaks the frozen protocol (CLAUDE.md hard rule). Use the RE sources, or
   a *different* ring, never ours.

---

## Index of what's been done this way

- **Live HR** — ✅ working (session 233). Enable = DHR on-demand burst (`2f 03 26 02 02`,
  ported from open_ring), decode = existing IBI `0x80`/`0x60`, battery-gated to rest. See
  ops-matrix R7 + `docs/superpowers/plans/2026-07-09-oura-ble-steps.md` for the next one.
- **Steps** — 🔨 in progress (`docs/superpowers/plans/2026-07-09-oura-ble-steps.md`). **Stage 2
  (ENABLE) shipped:** `REAL_STEPS 0x0b`→AUTOMATIC now rides `enableMeasurementSequence()` on every
  connect + an "Enable steps" tester lever. **Stages 3–4 (CAPTURE/DECODE) pending** an owner APK
  rebuild + a counted-step walk — the `0x7e`/`0x7f` layout is case (b) (must be cracked from
  captured frames).
