/**
 * The rest-timer beep — a short 880 Hz sine that fades out over 400 ms.
 *
 * Extracted from `workout-screen.tsx` (LA-177's PR): it holds no component state and is called from
 * one timer, so it was pure weight in a file `check-component-size` treats as a hotspot.
 *
 * Swallows everything. `AudioContext` is unavailable or blocked in several real cases here — a
 * WebView without a user gesture yet, an OS-level mute — and a missing beep must never break the
 * timer that scheduled it.
 */
export function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch { /* AudioContext unavailable */ }
}
