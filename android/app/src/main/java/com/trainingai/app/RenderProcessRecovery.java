package com.trainingai.app;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import com.getcapacitor.WebViewListener;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * BF-80 — recover from, and RECORD, the death of the WebView's render process.
 *
 * The owner reported the app coming back to a blank page after tabbing away, at 10% battery with
 * another app running, and `error_events` held nothing from it: `app/error.tsx` exists, so a JS
 * exception during render would have painted a fallback and filed a row. Neither happened, which is
 * what a dead renderer looks like — there is no JS left to throw, and the reporter died with the
 * context it would have reported.
 *
 * **Capacitor already forwards the event; nothing was listening.** `BridgeWebViewClient` overrides
 * `onRenderProcessGone` and calls every registered `WebViewListener`, and `WebViewListener`'s own
 * default returns `false` — which is the documented "the app is killed" answer, not "show nothing".
 * So the missing piece was never a `WebViewClient` (grepping `android/` for `RenderProcess` finds
 * none, correctly), it was a listener. Returning `true` is what keeps the process alive.
 *
 * **Recovery is `recreate()`, not `reload()`.** Once a renderer is gone its WebView is permanently
 * unusable — the platform is explicit that the instance must be destroyed rather than reused — so
 * asking it to reload is asking a dead object to work. Recreating the activity rebuilds the bridge
 * and the WebView from scratch; the shell comes back from the service-worker cache, which is what
 * that cache is for.
 *
 * **The marker is the other half, and it is the half that makes the hypothesis falsifiable.** The
 * entry could only reason about the cause because nothing recorded it. A row in SharedPreferences
 * survives the recreate, and the next JS boot turns it into an `error_events` row — so the next
 * occurrence is evidence rather than another report of a blank screen.
 */
public class RenderProcessRecovery extends WebViewListener {

    private static final String TAG = "RenderRecovery";
    private static final String PREFS = "render_process_recovery";
    private static final String KEY_PENDING = "pending";
    /** A crash loop must not grow an unbounded blob that the next boot then has to POST. */
    private static final int MAX_PENDING = 10;

    private final Activity activity;

    public RenderProcessRecovery(Activity activity) {
        this.activity = activity;
    }

    @Override
    public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
        // `didCrash()` separates the renderer crashing from the system reclaiming it under memory
        // pressure. Both need the same recovery; only the report can tell them apart, and the
        // owner's screenshot (10% battery, another app running) is the reclaim case if either.
        // No API guard: `didCrash()` is API 26 and this app's minSdk is 26.
        boolean didCrash = detail.didCrash();
        Log.w(TAG, "render process gone — didCrash=" + didCrash + ", recreating activity");
        record(didCrash);
        // POSTED, not called here. This callback runs on the UI thread with the WebView client on
        // the stack, and `recreate()` tears that WebView down — so it has to happen after this
        // returns `true`, not during it.
        new Handler(Looper.getMainLooper()).post(activity::recreate);
        // TRUE means "handled": without it the platform kills the process, which is the current
        // behaviour and is strictly worse than a reload.
        return true;
    }

    private void record(boolean didCrash) {
        try {
            SharedPreferences prefs = activity.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONArray pending = new JSONArray(prefs.getString(KEY_PENDING, "[]"));
            JSONObject event = new JSONObject();
            event.put("at", System.currentTimeMillis());
            event.put("didCrash", didCrash);
            event.put("sdk", Build.VERSION.SDK_INT);
            pending.put(event);
            // Keep the newest, drop the oldest: in a loop the recent ones describe the state that
            // matters, and the first is no more informative than the tenth.
            while (pending.length() > MAX_PENDING) pending.remove(0);
            prefs.edit().putString(KEY_PENDING, pending.toString()).apply();
        } catch (Exception e) {
            // Recovery must never depend on the reporting working. A failure here costs one row of
            // telemetry; letting it propagate would cost the reload.
            Log.e(TAG, "could not record render-process death", e);
        }
    }

    /** The recorded deaths as a JSON array, clearing them — so one death is reported once. */
    public static String consumePending(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String pending = prefs.getString(KEY_PENDING, "[]");
        prefs.edit().remove(KEY_PENDING).apply();
        return pending;
    }
}
