package com.trainingai.app.scale

import kotlin.math.abs

/**
 * Q-104. Whether an unstable reading is evidence that a NEW physical weigh-in has begun.
 *
 * `ScaleBleService.onUnstableReading` treats every such notification as proof someone is standing on
 * the scale right now, and undoes the post-capture suppression on that basis. It is the one path
 * that bypasses the whole `hasCapturedThisWake`/`hasSeenActivityThisWake` system built to stop a
 * reconnect-with-nobody-there from looking like a weigh-in — and the owner has reported the
 * "Weighing you…" bar appearing on an empty scale twice, the second time with the notification shade
 * showing a genuine capture at 5:46 and a fresh cycle at 5:47.
 *
 * Cheap BLE body-composition scales are documented to replay their last-buffered notification when a
 * client resubscribes, and returning to the Home tab re-links this service. A replayed notification
 * carries the value it carried the first time, so a reading identical to the capture we just took is
 * the one case that cannot be a new person stepping on.
 *
 * **Deliberately narrow, because this ships without an on-device confirmation of the replay theory.**
 * It cannot fire before a capture has happened this wake, and it cannot fire on a reading that
 * differs from that capture by even a gram. If the theory is wrong the gate simply never engages and
 * nothing changes. If a real second weigh-in lands within a gram of the first, the cost is a missing
 * progress bar — `onWeighIn` is a separate callback and is not gated, so no weight is ever lost.
 */
object ScaleWeighInGate {
    /** One gram. A replay is the same decoded packet, so this only has to survive float equality. */
    private const val SAME_READING_TOLERANCE_KG = 0.001

    fun isNewWeighInEvidence(weightKg: Double, lastCapturedKg: Double?): Boolean {
        if (lastCapturedKg == null) return true
        return abs(weightKg - lastCapturedKg) >= SAME_READING_TOLERANCE_KG
    }
}
