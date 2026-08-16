## 2026-07-26 — Fix: Score Card Style setting didn't apply until app restart (v1.210.1)

Follow-up bug fix on the just-merged score-cards round 4-5 work (#785). The owner reported that
changing "Score Card Style" in More → Home Widgets didn't visibly change the home ring until the app
was fully closed and reopened — flagged as a possible "cachebust" need.

**Root cause:** not a cache problem — `OuraScoreChipRow` read the preference once on mount
(`useEffect(() => setRingStyle(loadScoreRingStyle()), [])`) and the settings write site
(`home-widgets-section.tsx`) was a bare `localStorage.setItem` with nothing to notify anyone. Any
already-mounted home screen never saw the change. Next's App Router client-side cache can also keep a
previously-visited route's component tree alive across a tab switch without remounting it, so even the
"navigate away and back" path that would normally re-run the effect isn't reliable — matching the
"only after a full restart" symptom exactly.

**Fix:** a same-window custom event, mirroring the existing `ta:oura-ble-synced` pattern already used
elsewhere in the codebase for this kind of live signal. `SCORE_RING_STYLE_CHANGE_EVENT` added to
`lib/home/home-prefs.ts`; the settings write site now dispatches it right after the `localStorage.setItem`;
`OuraScoreChipRow`'s effect now also subscribes to it (in addition to its one-time mount read) and
re-reads the preference whenever it fires — no remount required.

**Verification:** `tsc` clean, lint clean, full suite **1990 passing** (unrelated `onnxruntime-web`
failure pre-existing). Playwright, on the seeded user: with the home screen already mounted, dispatching
the same event the settings page dispatches (no navigation, no reload) flipped the ring from default
(114px) → accent ring (80px) → halo (glow marker present) → perforated (94px) instantly; a negative
control confirmed a **silent** `localStorage` write with no event dispatch does *not* update the mounted
screen, proving the event listener — not some incidental remount — is what fixes it. (Real click-through
UI navigation between More and Home was attempted too, but the Next.js dev-tools overlay button
overlaps the bottom-nav's Home tab at this viewport and intercepted the automated click; the direct
event-dispatch test above exercises the exact same code path without that unrelated dev-only
interference.)

**Not verified (device-gated):** Samsung-WebView real tab-switch behaviour (the dev-overlay interference
above doesn't exist in production/APK builds, so this isn't expected to be an issue there, but hasn't
been confirmed on-device).
