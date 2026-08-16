package com.trainingai.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build

/**
 * "Tell me only when it matters" for the always-on device services.
 *
 * The ring and chest-strap foreground services each show an ongoing "Connected · N% battery"
 * notification. Android requires *a* notification while a foreground service runs, so it cannot be
 * removed — but at IMPORTANCE_LOW it takes a status-bar icon and a normal shade slot for something
 * that is never actionable. Both ongoing channels are now IMPORTANCE_MIN.
 *
 * The battery reading IS actionable, but only once it is low. A NotificationChannel's importance is
 * fixed when the channel is created and cannot be raised for a single notification, so the alert
 * cannot simply be the ongoing notification turning loud — it is a **separate one-shot** on its own
 * channel, the same shape as the scale's "Weigh-in logged".
 *
 * Hysteresis is not optional here. The ring polls battery every 5 minutes; without it, one low ring
 * would fire 288 notifications a day. Fires once on the way down and re-arms only after the battery
 * genuinely recovers (or the device goes on charge).
 */
object DeviceBatteryNotifier {
    /** Owner-chosen (2026-08-05): quiet above this, alert below. */
    const val LOW_THRESHOLD = 35
    /** Re-arm only above this, not at LOW_THRESHOLD — a reading hovering on the boundary would
     *  otherwise alternate armed/fired and notify on every other poll. */
    const val REARM_THRESHOLD = 40

    /**
     * Pure decision, extracted so the hysteresis is unit-testable without an Android runtime.
     *
     * @param alreadyFired whether an alert for this device is currently outstanding
     * @return the new `alreadyFired` state, and whether to post an alert now
     */
    data class Decision(val notify: Boolean, val fired: Boolean)

    fun decide(percent: Int, charging: Boolean, alreadyFired: Boolean): Decision {
        // On charge the reading is going up and the owner is already dealing with it.
        if (charging) return Decision(notify = false, fired = false)
        if (percent < LOW_THRESHOLD) return Decision(notify = !alreadyFired, fired = true)
        if (percent >= REARM_THRESHOLD) return Decision(notify = false, fired = false)
        return Decision(notify = false, fired = alreadyFired) // in the dead band: hold whatever we were
    }

    /** Post the one-shot low-battery alert. Channel is created on demand, same as every other. */
    fun post(ctx: Context, channelId: String, channelName: String, notifId: Int, deviceLabel: String, percent: Int, iconRes: Int) {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(channelId, channelName, NotificationManager.IMPORTANCE_DEFAULT))
        }
        val tap = PendingIntent.getActivity(
            ctx, notifId,
            Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        nm.notify(notifId, Notification.Builder(ctx, channelId)
            .setContentTitle("$deviceLabel battery low")
            .setContentText("$percent% remaining — worth charging it.")
            .setSmallIcon(iconRes)
            .setContentIntent(tap)
            .setAutoCancel(true)
            .build())
    }
}
