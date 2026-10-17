package com.trainingai.app

import java.net.URI

/**
 * Whether leaving the app should open picture-in-picture.
 *
 * It used to be `url.contains("/workout")` plus a phase that started as "rest", so Home on the
 * Workout tab (`/workout-select`) with no workout running shrank the app into a PiP window over
 * whatever opened next (#2908). PiP now needs the exact active-workout route AND a phase the web
 * layer reported for a running workout. The shell starts in [IDLE]; the workout screen sends
 * "idle" again when it unmounts. Pure and Android-free so it can be unit-tested on the JVM.
 */
object PipPolicy {
    const val IDLE: String = "idle"
    const val WORKOUT_PATH: String = "/workout"

    private val ACTIVE_PHASES = setOf("rest", "set", "complete", "summary")

    @JvmStatic
    fun isActivePhase(phase: String?): Boolean = phase in ACTIVE_PHASES

    @JvmStatic
    fun isWorkoutUrl(url: String?): Boolean {
        val path = try {
            URI(url ?: return false).path
        } catch (e: Exception) {
            return false
        } ?: return false
        return path == WORKOUT_PATH || path == "$WORKOUT_PATH/"
    }

    @JvmStatic
    fun shouldEnterPip(url: String?, phase: String?): Boolean =
        isActivePhase(phase) && isWorkoutUrl(url)
}
