'use client';

import { useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { WORKOUT_TIMERS_CHANNEL, ACTIVITY_DETECTION_CHANNEL } from '@/lib/notifications';
import { MEAL_REMINDERS_CHANNEL } from '@/lib/meal-reminders';
import { SUPPLEMENT_REMINDERS_CHANNEL } from '@/lib/supplement-reminders';
import { DAY_REVIEW_CHANNEL } from '@/lib/day-review-reminders';
import type { ScaleBlePlugin } from '@/lib/scale-ble/plugin';

// Ceiling for the live scale weigh-in toast — see its use below for why.
const SCALE_WEIGH_IN_TOAST_MAX_MS = 60_000;
// Mirrors ScaleBleService.CYCLE_BUDGET_MS (Kotlin, native side) — the toast's progress bar
// visualises the same deadline the native retry loop actually gives up at, so the two must be
// kept in sync by hand; there's no shared constant across the Kotlin/TS boundary.
const SCALE_CYCLE_BUDGET_MS = 12_000;

/** The live weigh-in toast's content, rendered via toast.custom() instead of a plain
 *  string/description so it can carry a progress bar tracking SCALE_CYCLE_BUDGET_MS — the owner
 *  asked for something that visually reflects how long the scale itself takes (2026-07-31), not
 *  an indefinite spinner. `cycleKey` changes only when a genuinely new weigh-in cycle starts (not
 *  on every retry within the same cycle) — passed as the bar's React `key` so it remounts fresh
 *  at that point and nowhere else; a label-only update (e.g. switching to "Still trying…" on a
 *  retry) re-renders this component without remounting the bar, leaving its transition running
 *  uninterrupted. Pure CSS transition, no JS ticking — matches the project's rule against
 *  per-frame timers driving UI.
 */
function ScaleWeighInProgressToast({ label, cycleKey }: { label: string; cycleKey: number }) {
  return (
    <div className="flex w-full flex-col gap-1.5 rounded-lg border border-[var(--normal-border)] bg-[var(--normal-bg)] p-4 text-[var(--normal-text)] shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        {label}
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-current/15">
        <div
          key={cycleKey}
          className="h-full w-full rounded-full bg-current/70"
          style={{ transitionProperty: 'width', transitionTimingFunction: 'linear', transitionDuration: `${SCALE_CYCLE_BUDGET_MS}ms` }}
          ref={(el) => {
            if (!el) return;
            // The "from" width (100%, set above) has to be committed in a paint before flipping
            // to the target, or the browser collapses the transition instead of animating it —
            // rAF is the standard way to force that commit. One-shot per mount, not a tick.
            requestAnimationFrame(() => { el.style.width = '0%'; });
          }}
        />
      </div>
    </div>
  );
}

/** The weigh-in toast's terminal states (logged/pending/skipped/failed) — also rendered via
 *  toast.custom(), not toast.success()/warning()/error(). Sonner's toast-update-by-id merges the
 *  old toast object with the new one (`{...oldToast, ...newData}`); toast.success/warning/error's
 *  public `data` type explicitly omits `jsx`, so calling one right after ScaleWeighInProgressToast
 *  (which sets `jsx`) can never clear that field — the merged toast keeps the STALE progress-bar
 *  jsx and renders it instead of the new title, while the new `description` (rendered separately,
 *  unconditionally on `toast.description`) bleeds through underneath it. Confirmed on-device
 *  2026-07-31: exactly that — a frozen "Weighing you…" bar with "Step off and back on to retry"
 *  showing below it. Using toast.custom() here too means every call explicitly sets a fresh
 *  `jsx`, so there's never a stale one left over regardless of which state precedes which. */
function ScaleWeighInResultToast({
  variant,
  title,
  description,
}: {
  variant: 'success' | 'warning' | 'error';
  title: string;
  description?: string;
}) {
  const Icon = variant === 'success' ? CheckCircle2 : variant === 'warning' ? AlertTriangle : XCircle;
  const colorVar = variant === 'success' ? '--success-text' : variant === 'warning' ? '--warning-text' : '--error-text';
  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-[var(--normal-border)] bg-[var(--normal-bg)] p-4 text-[var(--normal-text)] shadow-lg">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4 shrink-0" style={{ color: `var(${colorVar})` }} />
        {title}
      </div>
      {description ? <div className="pl-6 text-sm text-[var(--normal-text)] opacity-70">{description}</div> : null}
    </div>
  );
}

// The `loggingBehavior: 'none'` in capacitor.config.ts is the real fix, but it
// only takes effect on an APK rebuild. The bridge reads `cap.isLoggingEnabled`
// off `window.Capacitor` at every call site, live — so clearing it here turns
// the same logging off on APKs already installed, shipped through Railway.
// Module scope, not an effect: plugin traffic starts before effects run.
if (typeof window !== 'undefined') {
  const cap = (window as { Capacitor?: { isLoggingEnabled?: boolean } }).Capacitor;
  if (cap) cap.isLoggingEnabled = false;
}

export function CapacitorNativeInit() {
  const router = useRouter();
  const pathname = usePathname();
  // Lets the pathname-tracking effect below reach the plugin without re-importing/re-registering
  // it on every route change — set once inside the setup effect further down.
  const scaleBlePluginRef = useRef<ScaleBlePlugin | null>(null);
  // Distinguishes "first connecting event of a fresh weigh-in cycle" (start the progress bar)
  // from "connecting again mid-cycle because a retry just fired" (leave it running) — see
  // ScaleWeighInProgressToast's doc comment. scaleCycleKeyRef only increments on the former;
  // scaleCycleActiveRef flips back to false once scaleResult ends the cycle (success or failure).
  const scaleCycleActiveRef = useRef(false);
  const scaleCycleKeyRef = useRef(0);

  // Flag backgrounded state on <html> so globals.css can pause the decorative
  // background animation. Those loops are mounted in the root layout and
  // otherwise keep the main thread busy for as long as the app is open — a
  // device profile attributed 16% of main-thread time to dispatching their
  // animationiteration events alone, which nothing listens for.
  useEffect(() => {
    const sync = () => {
      document.documentElement.dataset.appHidden = String(document.visibilityState === 'hidden');
    };
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);

  useEffect(() => {
    let handle: { remove: () => void } | undefined;

    (async () => {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;

      try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        await SplashScreen.hide();
      } catch {
        // Plugin absent on pre-rebuild APKs — auto-hide covers it
      }

      try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        await StatusBar.setStyle({ style: Style.Dark });
      } catch {
        // Edge-to-edge enforced on Android 15+ — style may be a no-op, safe to ignore
      }

      try {
        const { LocalNotifications } = await import('@capacitor/local-notifications');
        await LocalNotifications.createChannel({
          id: WORKOUT_TIMERS_CHANNEL,
          name: 'Workout timers',
          description: 'Rest timer alerts during a workout',
          importance: 4,
          visibility: 1,
          vibration: true,
        });
        await LocalNotifications.createChannel({
          id: MEAL_REMINDERS_CHANNEL,
          name: 'Meal reminders',
          description: "Reminders to log a meal after its time window ends",
          importance: 3,
          visibility: 1,
          vibration: false,
        });
        await LocalNotifications.createChannel({
          id: SUPPLEMENT_REMINDERS_CHANNEL,
          name: 'Supplement reminders',
          description: 'Reminders to log daily supplements',
          importance: 3,
          visibility: 1,
          vibration: false,
        });
        await LocalNotifications.createChannel({
          id: DAY_REVIEW_CHANNEL,
          name: 'Day & week review reminders',
          description: 'Wind-down and weekly recap nudges',
          importance: 3,
          visibility: 1,
          vibration: false,
        });
        await LocalNotifications.createChannel({
          id: ACTIVITY_DETECTION_CHANNEL,
          name: 'Activity detection',
          description: 'Alerts when a walk or run is detected and recording',
          importance: 3,
          visibility: 1,
          vibration: false,
        });
        await LocalNotifications.requestPermissions();

        // Tapping a notification with an `extra.route` (e.g. meal reminders)
        // navigates to that page instead of just opening the app.
        handle = await LocalNotifications.addListener(
          'localNotificationActionPerformed',
          (event: { notification: { extra?: Record<string, unknown> } }) => {
            const route = event.notification.extra?.route;
            if (typeof route === 'string') router.push(route);
          },
        );
      } catch {}

      // Auto-start the Oura direct-BLE service on app open so the ring keeps
      // recording without the tester having to tap Start. No-op unless a ring
      // key is stored (owner only) and the foreground service isn't already
      // running — it's START_STICKY, so this only matters after a reinstall or
      // a force-stop. Permission is requested only if not already granted.
      try {
        const { getOuraBle } = await import('@/lib/oura-ble/plugin');
        const ref = await getOuraBle();
        if (ref) {
          const { plugin } = ref;
          // Tell the native service where to POST drained frames (it ingests
          // server-side itself; the resume cursor only advances on a 2xx).
          // Individually guarded: an APK older than the native-ingest build
          // rejects the call, and that must not skip the auto-start below.
          try { await plugin.setIngestUrl({ url: window.location.origin }); } catch {}
          if ((await plugin.hasKey()).hasKey) {
            const status = await plugin.getStatus();
            if (status.state === 'stopped') {
              const { granted } = await plugin.ensurePermissions();
              if (granted) await plugin.startService();
            }
          }
        }
      } catch {}

      // Re-arm the scale's passive BLE scan on app open if the user left it on — cheap and
      // idempotent (re-registering the same scan filter is a no-op if it's still active), and
      // covers the rare case the registration was dropped (e.g. Bluetooth cycled off/on). The
      // scan itself (ScaleBleScanManager) survives the app being killed, unlike the old
      // always-running service this replaced — this is a safety-net re-arm, not the primary
      // path. Opt-in only, unlike Oura above: no-op unless the owner both paired a scale AND
      // turned the toggle on in Settings > Profile (scale-pairing.tsx).
      try {
        const { getScaleBle } = await import('@/lib/scale-ble/plugin');
        const { getScaleBackgroundSyncEnabled } = await import('@/lib/scale-ble/paired-scale');
        const ref = await getScaleBle();
        if (ref) {
          const { plugin } = ref;
          scaleBlePluginRef.current = plugin;
          // Push the current route immediately — the pathname-tracking effect below only reacts
          // to subsequent changes, and by the time this native setup finishes the app may already
          // be sitting on a non-home route (e.g. a deep link straight into a sub-screen).
          plugin.setHomeScreenActive({ active: pathname === '/' }).catch(() => {});
          // Native emits these events regardless of which screen is mounted (or whether the
          // WebView is even visible) — nothing was listening for them before, so debugging a
          // background-sync issue meant scavenging adb logcat for lines the app never actually
          // logged there. console.info surfaces them live via chrome://inspect instead.
          plugin.addListener('scaleLog', ({ line }) => console.info('[scale-ble]', line)).catch(() => {});
          plugin.addListener('scaleStatus', ({ state }) => {
            console.info('[scale-ble] state=', state);
            // The OS notification-shade notifications (scale-ble-logged/-failed/etc.) aren't
            // visible while the app is open, so a live weigh-in was previously silent in-app —
            // same toast id throughout means each update replaces the last rather than stacking.
            // One message from the moment the BLE connection opens (not just once the scale
            // starts actually reporting a reading) — the two-phase "Detecting…"/"Weighing…" text
            // read as nothing happening until the toast flipped over, by which point the person
            // had often already stepped off. toast.custom (not toast.loading) is deliberate:
            // sonner hardcodes loading-type toasts as non-dismissible/non-swipeable, which is
            // wrong here since a stuck connection is exactly when the user wants to swipe it
            // away. An explicit duration means the toast self-clears even if a scaleResult event
            // is somehow never delivered — SCALE_WEIGH_IN_TOAST_MAX_MS comfortably covers
            // ScaleBleService's worst-case retry envelope with margin, so in the normal case the
            // toast always resolves to success/warning/error well before this.
            if (state === 'connecting' || state === 'waiting') {
              if (!scaleCycleActiveRef.current) {
                // First 'connecting' of a fresh cycle, not a mid-cycle retry reconnect — start the
                // progress bar now. A retry's own 'connecting' event arrives with
                // scaleCycleActiveRef already true, so it's excluded here and the bar keeps
                // counting down against the original cycle start, matching what
                // ScaleBleService.onCycleDeadline() actually measures against natively.
                scaleCycleActiveRef.current = true;
                scaleCycleKeyRef.current += 1;
              }
              toast.custom(
                () => <ScaleWeighInProgressToast label="Weighing you…" cycleKey={scaleCycleKeyRef.current} />,
                { id: 'scale-weigh-in', duration: SCALE_WEIGH_IN_TOAST_MAX_MS },
              );
            } else if (state === 'retrying') {
              // The first connection attempt after a scan hit can miss the scale's own short
              // awake window (already asleep by the time we connect) — ScaleBleService retries
              // up to twice more. Without this, the toast just sits on "Weighing you…" through
              // every retry, indistinguishable from a genuinely hung connection.
              toast.custom(
                () => <ScaleWeighInProgressToast label="Still trying — stay on the scale…" cycleKey={scaleCycleKeyRef.current} />,
                { id: 'scale-weigh-in', duration: SCALE_WEIGH_IN_TOAST_MAX_MS },
              );
            }
          }).catch(() => {});
          plugin.addListener('scaleResult', (result) => {
            // Cycle over either way — the next 'connecting' event (a fresh scan hit) should start
            // a new progress bar, not continue counting down against this one.
            scaleCycleActiveRef.current = false;
            if (result.outcome === 'logged') {
              toast.custom(() => (
                <ScaleWeighInResultToast
                  variant="success"
                  title={`${result.weightKg?.toFixed(1)} kg logged`}
                  description={result.isAdditionalReadingToday ? 'Additional reading today' : undefined}
                />
              ), { id: 'scale-weigh-in' });
            } else if (result.outcome === 'skipped') {
              toast.custom(() => (
                <ScaleWeighInResultToast
                  variant="success"
                  title={`${result.weightKg?.toFixed(1)} kg logged`}
                  description="Body composition skipped — stand barefoot on the plates"
                />
              ), { id: 'scale-weigh-in' });
            } else if (result.outcome === 'pending') {
              toast.custom(() => (
                <ScaleWeighInResultToast
                  variant="warning"
                  title={`${result.weightKg?.toFixed(1)} kg — looks different from usual`}
                  description="Confirm it’s you in Settings › Scale"
                />
              ), { id: 'scale-weigh-in' });
            } else {
              toast.custom(() => (
                <ScaleWeighInResultToast
                  variant="error"
                  title="Didn’t catch that"
                  description="Step off and back on to retry"
                />
              ), { id: 'scale-weigh-in' });
            }
          }).catch(() => {});
          if (getScaleBackgroundSyncEnabled()) {
            try { await plugin.setIngestUrl({ url: window.location.origin }); } catch {}
            const { granted } = await plugin.ensurePermissions();
            if (granted) await plugin.startService();
          }
        }
      } catch {}
    })();

    return () => handle?.remove();
    // pathname is read for its value at mount, not tracked — this setup effect must run once
    // only (splash screen, notification channels, etc.), not re-run on every navigation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // Scopes the live foreground BLE scan (ScaleForegroundScanner, native side) to the home screen
  // specifically, not "the app is open anywhere" — separate effect since it must react to every
  // route change, unlike the one-time setup effect above. No-op on web / before the plugin setup
  // effect has run (scaleBlePluginRef.current still null).
  useEffect(() => {
    scaleBlePluginRef.current?.setHomeScreenActive({ active: pathname === '/' }).catch(() => {});
  }, [pathname]);

  return null;
}
