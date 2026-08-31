package com.trainingai.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.PictureInPictureParams;
import android.app.RemoteAction;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.drawable.Icon;
import android.hardware.Sensor;
import android.hardware.SensorManager;
import android.hardware.TriggerEvent;
import android.hardware.TriggerEventListener;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.util.Rational;
import android.webkit.JavascriptInterface;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends BridgeActivity {

    private static final String ACTION_WEIGHT_DOWN = "com.trainingai.app.PIP_W_DOWN";
    private static final String ACTION_REPS_DOWN   = "com.trainingai.app.PIP_R_DOWN";
    private static final String ACTION_LOG         = "com.trainingai.app.PIP_LOG";
    private static final String ACTION_REPS_UP     = "com.trainingai.app.PIP_R_UP";
    private static final String ACTION_WEIGHT_UP   = "com.trainingai.app.PIP_W_UP";

    // Current workout phase — kept up to date by the JS bridge so the right
    // buttons are shown when the user presses home to enter PiP.
    private volatile String pipPhase = "rest";

    private final BroadcastReceiver pipReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (action == null) return;
            final String jsAction;
            switch (action) {
                case ACTION_WEIGHT_DOWN: jsAction = "weightDown"; break;
                case ACTION_REPS_DOWN:   jsAction = "repsDown";   break;
                case ACTION_LOG:         jsAction = "log";        break;
                case ACTION_REPS_UP:     jsAction = "repsUp";     break;
                case ACTION_WEIGHT_UP:   jsAction = "weightUp";   break;
                default: return;
            }
            String js = "window.dispatchEvent(new CustomEvent('pipAction',{detail:{action:'"
                + jsAction + "'}}))";
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(js, null)
            );
        }
    };

    // Exposed to JS as window.AndroidPip — called whenever the workout phase
    // changes so we can update the PiP action buttons in real time.
    private class PipBridge {
        @JavascriptInterface
        public void updatePhase(String phase) {
            pipPhase = phase;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                runOnUiThread(() -> setPictureInPictureParams(buildPipParams(phase)));
            }
        }
    }

    // Exposed to JS as window.AndroidRenderer — BF-80. The renderer's death is recorded
    // natively because there is no JS alive to record it at the time; this is how the next boot
    // collects it and turns it into an `error_events` row. Consuming clears it, so one death is
    // reported once.
    private class RendererBridge {
        @JavascriptInterface
        public String consumeRenderProcessGone() {
            return RenderProcessRecovery.consumePending(MainActivity.this);
        }
    }

    // Exposed to JS as window.AndroidScreen — lets the workout screen keep the
    // display on while a session is active without any Capacitor plugin.
    private class ScreenBridge {
        @JavascriptInterface
        public void setKeepAwake(boolean keepAwake) {
            runOnUiThread(() -> getBridge().getWebView().setKeepScreenOn(keepAwake));
        }
    }

    // Significant-motion sensor plumbing. TYPE_SIGNIFICANT_MOTION is a hardware
    // one-shot trigger that fires (even with the screen off) once the device
    // moves meaningfully, then auto-disarms. Passive activity detection uses it
    // to wake GPS only when the user starts moving instead of streaming GPS
    // continuously — the previous approach drained the battery.
    private SensorManager sensorManager;
    private Sensor significantMotionSensor;
    private TriggerEventListener motionListener;

    private void ensureMotionSensor() {
        if (sensorManager != null) return;
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            significantMotionSensor = sensorManager.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION);
        }
        motionListener = new TriggerEventListener() {
            @Override
            public void onTrigger(TriggerEvent event) {
                // One-shot: the sensor auto-disarms here. JS re-arms via
                // AndroidMotion.arm() when it wants to listen again.
                getBridge().getWebView().post(() ->
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('motionTrigger'))", null)
                );
            }
        };
    }

    // Exposed to JS as window.AndroidMotion — lets passive activity detection
    // arm the significant-motion sensor and gate GPS on real movement.
    private class MotionBridge {
        @JavascriptInterface
        public boolean isAvailable() {
            ensureMotionSensor();
            return significantMotionSensor != null;
        }

        @JavascriptInterface
        public void arm() {
            ensureMotionSensor();
            if (significantMotionSensor != null) {
                sensorManager.requestTriggerSensor(motionListener, significantMotionSensor);
            }
        }

        @JavascriptInterface
        public void disarm() {
            if (sensorManager != null && significantMotionSensor != null && motionListener != null) {
                sensorManager.cancelTriggerSensor(motionListener, significantMotionSensor);
            }
        }
    }

    // Exposed to JS as window.AndroidLocation — lets passive activity detection
    // check whether "Allow all the time" background location is actually granted
    // (the @capacitor-community/background-geolocation plugin only ever requests
    // foreground ACCESS_FINE/COARSE_LOCATION, never ACCESS_BACKGROUND_LOCATION, so
    // JS has no other way to know why the watcher silently never gets a fix) and
    // jump straight to the app's location permission settings page.
    private class LocationBridge {
        @JavascriptInterface
        public boolean isBackgroundGranted() {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
                // Background location wasn't a separate grant before Android 10 —
                // foreground access implies background access.
                return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
                    || ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
            }
            return ContextCompat.checkSelfPermission(MainActivity.this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.fromParts("package", getPackageName(), null));
                startActivity(intent);
            });
        }
    }

    // Exposed to JS as window.AndroidRestChip — posts an Android 16 promoted
    // ongoing notification whose status-bar chip (One UI Now Bar, next to the
    // clock) ticks the rest countdown down. The OS renders the chronometer from
    // the finish timestamp, so JS only fires discrete start/stop events — no
    // per-second updates from the background-throttled WebView. Tapping the chip
    // brings the app to the front on the workout screen.
    private static final int REST_CHIP_ID = 4100;
    private static final String REST_CHANNEL_ID = "rest-timer";
    // Long zombie-safety only: the chip normally clears when JS sends stop() (the
    // next set starts / the workout is left). It must NOT clear at the rest
    // boundary — at 0:00 it flips to a count-up "overtime" state instead, so the
    // pill never vacates the Now Bar slot (which let another app's chip steal it).
    private static final long REST_CHIP_SAFETY_MS = 30L * 60L * 1000L;
    // Pill tints — the Now Bar chip follows the notification's accent colour.
    // Overtime = the app's rest-overtime red (#ef4444); warm-up/prep = green
    // (#22c55e) so "getting ready" reads apart from a working-set rest (blue).
    private static final int OVERTIME_COLOR = 0xFFEF4444;
    private static final int WARMUP_COLOR = 0xFF22C55E;

    // Run status chip — its own notification ID/channel so a live run and a
    // lifting rest timer (a different screen, but could theoretically overlap
    // if the user leaves a workout mid-rest and starts a run) never collide.
    private static final int RUN_CHIP_ID = 4200;
    private static final String RUN_CHANNEL_ID = "run-status";
    // Same zombie-safety rationale as REST_CHIP_SAFETY_MS.
    private static final long RUN_CHIP_SAFETY_MS = 4L * 60L * 60L * 1000L;

    // Run-chip live state — mirrors the rest-chip fields above.
    private volatile boolean runChipActive = false;
    private volatile String runChipLabel = "Run";
    private volatile long runChipFinishAt = 0L;
    private volatile boolean runChipCountDown = false;
    private final Handler runHandler = new Handler(Looper.getMainLooper());
    // Fires at a duration-mode chip's target instant to flip it to a count-up
    // "over target" state, mirroring restOvertimeRunnable.
    private final Runnable runOvertimeRunnable = () -> {
        if (runChipActive && runChipCountDown) postRunClockNotification(true);
    };

    // Rest-chip live state. Written by the JS bridge thread, read on the UI thread
    // (onUserLeaveHint) and by the overtime runnable — volatile for visibility.
    private volatile boolean restChipActive = false;
    private volatile boolean restChipWarmup = false;
    private volatile String restChipLabel = "Rest";
    private volatile long restChipFinishAt = 0L;
    private final Handler restHandler = new Handler(Looper.getMainLooper());
    // Fires at the rest/prep boundary to re-post the chip in its "over" state (so it never
    // vanishes from the Now Bar). A working-set rest re-posts counting UP in red; a warm-up/
    // bar-load prep re-posts still counting DOWN (into negative "−M:SS") and flips green→red.
    // Preserves the warm-up flag so the pill keeps its no-"Start set" behaviour while over.
    private final Runnable restOvertimeRunnable = () -> {
        if (restChipActive) postRestNotification(true, restChipWarmup);
    };

    private class RestChipBridge {
        // mode: "rest" = working-set rest (counts down, blue → red count-up once over);
        // "warmup" = warm-up / bar-load / get-ready prep (counts down, green → red negative
        // "−" count-down once past its target). anchorMs is the count-down finish for both
        // (a future instant); a warm-up anchored in the past posts straight into the over state.
        @JavascriptInterface
        public void start(String anchorMs, String label, String mode) {
            final long anchor;
            try {
                anchor = Long.parseLong(anchorMs);
            } catch (NumberFormatException e) {
                return;
            }
            restChipLabel = (label == null || label.isEmpty()) ? "Rest" : label;
            restChipFinishAt = anchor;
            restChipWarmup = "warmup".equals(mode);
            restChipActive = true;
            postRestChip(anchor, restChipWarmup);
        }

        @JavascriptInterface
        public void stop() {
            restChipActive = false;
            restHandler.removeCallbacks(restOvertimeRunnable);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(REST_CHIP_ID);
        }
    }

    private class RunChipBridge {
        // mode: "duration" = counts down to anchorMs, flips to count-up once past it;
        // "elapsed" = counts up from anchorMs (a fixed past instant), no target, no flip.
        @JavascriptInterface
        public void startClock(String anchorMs, String label, String mode) {
            final long anchor;
            try {
                anchor = Long.parseLong(anchorMs);
            } catch (NumberFormatException e) {
                return;
            }
            runHandler.removeCallbacks(runOvertimeRunnable);
            runChipLabel = (label == null || label.isEmpty()) ? "Run" : label;
            runChipFinishAt = anchor;
            runChipCountDown = "duration".equals(mode);
            runChipActive = true;

            if (runChipCountDown) {
                long remainingMs = anchor - System.currentTimeMillis();
                if (remainingMs > 0) {
                    postRunClockNotification(false);
                    runHandler.postDelayed(runOvertimeRunnable, remainingMs);
                } else {
                    postRunClockNotification(true);
                }
            } else {
                postRunClockNotification(false);
            }
        }

        // Distance-mode static-text chip — re-posted by JS on each GPS fix.
        @JavascriptInterface
        public void updateText(String label, String text) {
            runHandler.removeCallbacks(runOvertimeRunnable);
            runChipCountDown = false;
            runChipActive = true;
            postRunTextNotification(
                (label == null || label.isEmpty()) ? "Run" : label,
                text == null ? "" : text);
        }

        @JavascriptInterface
        public void stop() {
            runChipActive = false;
            runHandler.removeCallbacks(runOvertimeRunnable);
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(RUN_CHIP_ID);
        }
    }

    private void postRestChip(long anchorMs, boolean warmup) {
        restHandler.removeCallbacks(restOvertimeRunnable);
        // Both a working-set rest and a warm-up/bar-load prep count DOWN to their target
        // (anchorMs, a future instant), then re-post in an "over" state at the boundary
        // (rest → red count-up; warm-up → red negative "−" count-down). Tint/label/direction
        // are handled in postRestNotification via the warmup + overtime flags. (A warm-up
        // with no meaningful target is anchored in the past by JS, so remainingMs <= 0 and
        // it posts straight into the over state.)
        long remainingMs = anchorMs - System.currentTimeMillis();
        if (remainingMs > 0) {
            postRestNotification(false, warmup);
            restHandler.postDelayed(restOvertimeRunnable, remainingMs);
        } else {
            // Target already elapsed when posted (e.g. resumed mid-prep/overtime) — count up.
            postRestNotification(true, warmup);
        }
    }

    private void postRestNotification(boolean overtime, boolean warmup) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;

        // IMPORTANCE_LOW: the chip is the point, not an audible/heads-up alert
        // (the separate scheduled rest-complete notification handles the "rest
        // over" beep). No badge — this is transient live state, not an inbox item.
        NotificationChannel channel =
            new NotificationChannel(REST_CHANNEL_ID, "Rest timer", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);

        // Tap → bring this single-instance Activity to the front (the workout is
        // still mounted + persisted, so the user lands right back on it) and hint
        // JS to route back if the WebView had navigated to another tab.
        Intent tap = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .putExtra("open", "workout")
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this, 41, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // "Start set" action → the same broadcast the PiP "Log" button fires, handled
        // by pipReceiver → a pipAction JS event → the workout screen starts the next
        // set. The receiver stays registered while the app is backgrounded
        // (onCreate→onDestroy), so this works from the notification without opening
        // the app.
        Intent startSet = new Intent(ACTION_LOG).setPackage(getPackageName());
        PendingIntent startSetPi = PendingIntent.getBroadcast(
            this, 42, startSet, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // NotificationCompat (androidx.core ≥ 1.17.0) — setRequestPromotedOngoing is
        // what actually promotes an ongoing notification to the Android 16 status-bar
        // chip / One UI Now Bar; the compat wrapper writes the correct platform extra
        // and no-ops below API 36. CATEGORY_STOPWATCH marks it as a timer. The chip's
        // text is the chronometer: it counts DOWN to the rest end (setWhen in the
        // future), then the overtime re-post flips it to count UP from the same
        // instant (setWhen now in the past, countDown false) so it reads as elapsed
        // overtime instead of vanishing. On < Android 16 the same builder shows a
        // live countdown in the shade + on the lock screen.
        // The chip text is the chronometer: both a working-set rest and a warm-up/prep
        // pill count DOWN to their target (setWhen in the future), then the boundary
        // re-post flips to count UP from that instant (setWhen now in the past,
        // countDown false) so it reads as elapsed-over instead of vanishing.
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, REST_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(restChipLabel)
            .setContentText(warmup
                ? (overtime ? "Prep time up" : "Getting ready")
                : (overtime ? "Rest over — tap Start set" : "Resting"))
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(restChipFinishAt)
            .setUsesChronometer(true)
            // Warm-up/prep counts DOWN the whole time: green while positive, then keeps
            // counting down past its target so it reads as a negative "−M:SS" over-run (the
            // system chronometer prepends the minus). A working-set rest instead flips to
            // count UP at its boundary (its overtime is shown as positive elapsed).
            .setChronometerCountDown(warmup || !overtime)
            .setTimeoutAfter(REST_CHIP_SAFETY_MS)
            .setRequestPromotedOngoing(true);

        // The "Start set" action only makes sense for a working-set rest, not the
        // warm-up/prep pill.
        if (!warmup) builder.addAction(R.drawable.pip_start, "Start set", startSetPi);

        // Tint the pill (the Now Bar chip follows the notification's accent colour):
        // red once the target is passed (a rest that's over, or a warm-up/prep that's run
        // long — the "−" over-run), green while a warm-up/prep is still counting down,
        // otherwise the system default so a working-set rest stays the familiar blue.
        if (overtime) builder.setColor(OVERTIME_COLOR);
        else if (warmup) builder.setColor(WARMUP_COLOR);

        nm.notify(REST_CHIP_ID, builder.build());
    }

    private NotificationChannel runChannel(NotificationManager nm) {
        NotificationChannel channel =
            new NotificationChannel(RUN_CHANNEL_ID, "Run status", NotificationManager.IMPORTANCE_LOW);
        channel.setShowBadge(false);
        nm.createNotificationChannel(channel);
        return channel;
    }

    private PendingIntent runTapIntent() {
        Intent tap = new Intent(this, MainActivity.class)
            .setAction(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .putExtra("open", "activity")
            .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        return PendingIntent.getActivity(
            this, 43, tap, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    // Duration/elapsed clock chip — counts down to runChipFinishAt (duration mode,
    // then flips to count up once past it) or counts up from runChipFinishAt
    // (elapsed mode, no target). Same chronometer mechanism as the rest chip.
    private void postRunClockNotification(boolean overtime) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        runChannel(nm);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RUN_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(runChipLabel)
            .setContentText(overtime ? "Past target — still going" : "In progress")
            .setContentIntent(runTapIntent())
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(true)
            .setWhen(runChipFinishAt)
            .setUsesChronometer(true)
            .setChronometerCountDown(runChipCountDown && !overtime)
            .setTimeoutAfter(RUN_CHIP_SAFETY_MS)
            .setRequestPromotedOngoing(true);

        if (overtime) builder.setColor(OVERTIME_COLOR);

        nm.notify(RUN_CHIP_ID, builder.build());
    }

    // Distance-mode chip — arbitrary static text (no chronometer), re-posted by
    // JS whenever distanceKm/pace change meaningfully.
    private void postRunTextNotification(String label, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        runChannel(nm);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, RUN_CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_rest_timer)
            .setContentTitle(label)
            .setContentText(text)
            .setContentIntent(runTapIntent())
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setTimeoutAfter(RUN_CHIP_SAFETY_MS)
            .setRequestPromotedOngoing(true);

        nm.notify(RUN_CHIP_ID, builder.build());
    }

    // Bring the WebView back to the workout/activity screen when the app is
    // re-entered via a chip tap (only acts if it had navigated elsewhere within
    // the app).
    private void handleOpenIntent(Intent intent) {
        if (intent == null) return;
        String open = intent.getStringExtra("open");
        if ("workout".equals(open)) {
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('restChipOpen'))", null)
            );
        } else if ("activity".equals(open)) {
            getBridge().getWebView().post(() ->
                getBridge().getWebView().evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('runChipOpen'))", null)
            );
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleOpenIntent(intent);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(com.trainingai.app.oura.OuraBlePlugin.class);
        registerPlugin(com.trainingai.app.polar.PolarBlePlugin.class);
        registerPlugin(com.trainingai.app.scale.ScaleBlePlugin.class);
        registerPlugin(com.trainingai.app.media.MediaSavePlugin.class);
        super.onCreate(savedInstanceState);
        // BF-80. Registered before anything else touches the WebView: Capacitor already forwards
        // `onRenderProcessGone` to its listeners and the default answer is `false`, which the
        // platform reads as "kill the app". Without a listener there is no recovery at all.
        getBridge().addWebViewListener(new RenderProcessRecovery(this));
        getBridge().getWebView().addJavascriptInterface(new PipBridge(), "AndroidPip");
        getBridge().getWebView().addJavascriptInterface(new ScreenBridge(), "AndroidScreen");
        getBridge().getWebView().addJavascriptInterface(new MotionBridge(), "AndroidMotion");
        getBridge().getWebView().addJavascriptInterface(new LocationBridge(), "AndroidLocation");
        getBridge().getWebView().addJavascriptInterface(new RestChipBridge(), "AndroidRestChip");
        getBridge().getWebView().addJavascriptInterface(new RunChipBridge(), "AndroidRunChip");
        getBridge().getWebView().addJavascriptInterface(new RendererBridge(), "AndroidRenderer");
        // Suppress Android's long-press context menu in the WebView so it doesn't
        // send pointercancel and cancel dnd-kit's 300ms drag activation delay.
        getBridge().getWebView().setOnLongClickListener(v -> true);
        // Registered for the whole activity lifetime (not just while started) so the
        // rest-chip "Start set" notification action is delivered even when the app is
        // backgrounded without PiP.
        registerPipReceiver();
        handleOpenIntent(getIntent());
    }

    private void registerPipReceiver() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_WEIGHT_DOWN);
        filter.addAction(ACTION_REPS_DOWN);
        filter.addAction(ACTION_LOG);
        filter.addAction(ACTION_REPS_UP);
        filter.addAction(ACTION_WEIGHT_UP);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(pipReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(pipReceiver, filter);
        }
    }

    @Override
    public void onDestroy() {
        restHandler.removeCallbacks(restOvertimeRunnable);
        try { unregisterReceiver(pipReceiver); } catch (IllegalArgumentException ignored) {}
        super.onDestroy();
    }

    // Live scale scan only while the app is actually on-screen AND JS reports the home screen is
    // showing — see ScaleForegroundScanner's class doc for why this exists alongside
    // ScaleBleScanManager's always-on background scan, and why it's gated on both signals. No-ops
    // itself (via SharedPreferences) when the scale background-sync toggle is off.
    @Override
    public void onResume() {
        super.onResume();
        com.trainingai.app.scale.ScaleForegroundScanner.INSTANCE.setAppResumed(this, true);
    }

    @Override
    public void onPause() {
        com.trainingai.app.scale.ScaleForegroundScanner.INSTANCE.setAppResumed(this, false);
        super.onPause();
    }

    // Enter PiP when user presses home, but only while actively working out.
    @Override
    public void onUserLeaveHint() {
        super.onUserLeaveHint();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // While the rest chip is live, the status-bar pill is the leave surface —
            // Samsung suppresses the pill if this app also shows a PiP window, so skip
            // PiP during rest and let the pill (with its countdown + Start set button)
            // show instead. PiP still opens for the active-set view.
            if (restChipActive) return;
            String url = getBridge().getWebView().getUrl();
            boolean activePhase = "rest".equals(pipPhase) || "set".equals(pipPhase)
                || "complete".equals(pipPhase) || "summary".equals(pipPhase);
            if (url != null && url.contains("/workout") && activePhase) {
                enterPictureInPictureMode(buildPipParams(pipPhase));
            }
        }
    }

    // Notify the WebView when PiP mode changes so React can switch views.
    @Override
    public void onPictureInPictureModeChanged(boolean isInPiPMode, Configuration newConfig) {
        super.onPictureInPictureModeChanged(isInPiPMode, newConfig);
        String js = "window.dispatchEvent(new CustomEvent('pipModeChanged',{detail:{active:"
            + isInPiPMode + "}}))";
        getBridge().getWebView().post(() ->
            getBridge().getWebView().evaluateJavascript(js, null)
        );
    }

    private PictureInPictureParams buildPipParams(String phase) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null;
        return new PictureInPictureParams.Builder()
            .setAspectRatio(new Rational(3, 4))
            .setActions(buildActions(phase))
            .build();
    }

    private List<RemoteAction> buildActions(String phase) {
        List<RemoteAction> actions = new ArrayList<>();
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return actions;

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;

        switch (phase) {
            case "set":
                // 3 visible actions (Android/Samsung PiP limit)
                actions.add(makeAction(ACTION_REPS_DOWN, R.drawable.pip_minus, "Reps -", 1, flags));
                actions.add(makeAction(ACTION_REPS_UP,   R.drawable.pip_plus,  "Reps +", 3, flags));
                actions.add(makeAction(ACTION_LOG,       R.drawable.pip_log,   "Log",    2, flags));
                break;
            case "rest":
                // Resting between sets: single button to start the next set
                actions.add(makeAction(ACTION_LOG, R.drawable.pip_start, "Start Set", 2, flags));
                break;
            case "complete":
                // All sets done, resting after last set: complete the exercise
                actions.add(makeAction(ACTION_LOG, R.drawable.pip_log, "Complete", 2, flags));
                break;
            case "summary":
                // Exercise summary: advance to the next exercise (or finish)
                actions.add(makeAction(ACTION_LOG, R.drawable.pip_start, "Next", 2, flags));
                break;
            // "done": no buttons — workout is finished
        }
        return actions;
    }

    private RemoteAction makeAction(String broadcastAction, int iconRes, String label, int reqCode, int flags) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return null;
        Intent intent = new Intent(broadcastAction).setPackage(getPackageName());
        PendingIntent pi = PendingIntent.getBroadcast(this, reqCode, intent, flags);
        Icon icon = Icon.createWithResource(this, iconRes);
        return new RemoteAction(icon, label, label, pi);
    }
}
