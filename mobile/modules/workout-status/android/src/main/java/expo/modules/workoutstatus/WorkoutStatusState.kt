package expo.modules.workoutstatus

// What the workout's ongoing notification says, and when it may be posted. Pure and Android-free
// so it runs as a JVM unit test, as PipState does. The notification only displays state: the
// session itself stays in the app's journal, and JS sends a fresh WorkoutStatus whenever it changes.

/** The payload JS sends (`statusFor` in workout-status.ts). */
data class WorkoutStatus(
  /** The journal's workout id: what a tap returns to, and what a dismissal is remembered against. */
  val workoutId: String,
  val sessionName: String,
  /** The exercise on screen, or the session's name in the warm-up and the review. */
  val exerciseName: String,
  /** "working", "resting", "ready" (between sets, no timer) or "paused". */
  val phase: String,
  /** The set in progress or next, 1-based; 0 when there is none to name. */
  val nextSet: Int = 0,
  val sets: Int = 0,
  /** Only what the plan or the logger knows: "80 kg × 8", "80 kg", "× 8", or null. */
  val load: String? = null,
  val restEndsAt: Long? = null,
  /** Shown when there is no set to name: "Warm-up", "Exercise done". */
  val label: String? = null,
  /** When the workout began; 0 when unknown. A workout open past MAX_AGE_MS posts nothing. */
  val startedAt: Long = 0,
)

data class WorkoutPresentation(
  val title: String,
  val text: String,
  val subText: String,
  /** The status-bar chip's text when promoted; null leaves the chip to the countdown. */
  val shortCriticalText: String?,
  /** The countdown's end, drawn by the system; null when nothing counts down. */
  val countdownEndsAt: Long?,
)

object WorkoutStatusPresenter {
  const val WORKING = "working"
  const val RESTING = "resting"
  const val READY = "ready"
  const val PAUSED = "paused"
  private val PHASES = setOf(WORKING, RESTING, READY, PAUSED)

  fun present(status: WorkoutStatus, nowMs: Long): WorkoutPresentation {
    val named = status.nextSet in 1..status.sets
    val progress = if (named) "Set ${status.nextSet} of ${status.sets}" else null
    val step = listOfNotNull(progress ?: status.label, status.load?.takeIf { named })
    fun line(lead: String?) = (listOfNotNull(lead) + step).joinToString(" · ").ifEmpty { "Workout in progress" }
    // The chip shows its text only if all of it fits (7 characters), so no "Set" in front.
    val chip = if (named) "${status.nextSet}/${status.sets}" else null
    // A rest that has ended is not counted down: a countdown chronometer past zero reads "-0:05",
    // which is the wrong thing to show on a notification nobody is updating.
    val counting = status.phase == RESTING && status.restEndsAt != null && status.restEndsAt > nowMs
    return when {
      status.phase == PAUSED ->
        WorkoutPresentation(status.exerciseName, line("Paused"), status.sessionName, "Paused", null)
      counting ->
        WorkoutPresentation(
          status.exerciseName,
          line(if (named) "Resting, next" else "Resting"),
          status.sessionName,
          null,
          status.restEndsAt,
        )
      status.phase == WORKING ->
        WorkoutPresentation(status.exerciseName, line(null), status.sessionName, chip, null)
      else ->
        WorkoutPresentation(
          status.exerciseName,
          line(if (status.phase == RESTING && named) "Rest over, next" else if (named) "Next" else null),
          status.sessionName,
          chip,
          null,
        )
    }
  }

  /** Reads the JS payload; anything malformed yields null rather than a broken notification. */
  fun fromMap(map: Map<String, Any?>?): WorkoutStatus? {
    if (map == null) return null
    val id = (map["workoutId"] as? String)?.takeIf { it.isNotBlank() } ?: return null
    val exercise = (map["exerciseName"] as? String)?.takeIf { it.isNotBlank() } ?: return null
    val phase = (map["phase"] as? String)?.takeIf { it in PHASES } ?: return null
    fun int(key: String) = (map[key] as? Number)?.toInt() ?: 0
    return WorkoutStatus(
      workoutId = id,
      sessionName = (map["sessionName"] as? String).orEmpty(),
      exerciseName = exercise,
      phase = phase,
      nextSet = int("nextSet"),
      sets = int("sets"),
      load = (map["load"] as? String)?.takeIf { it.isNotBlank() },
      restEndsAt = (map["restEndsAt"] as? Number)?.toLong(),
      label = (map["label"] as? String)?.takeIf { it.isNotBlank() },
      startedAt = (map["startedAt"] as? Number)?.toLong() ?: 0,
    )
  }
}

object WorkoutStatusPolicy {
  /**
   * Build.VERSION_CODES_FULL.BAKLAVA_1, Android 16 QPR2. `Notification.Builder.setRequestPromotedOngoing`
   * and `EXTRA_REQUEST_PROMOTED_ONGOING` first appear in the 36.1 SDK; SDK_INT is 36 on 36.0 and 36.1
   * alike, so only SDK_INT_FULL tells them apart. The constant is not in the 36.0 stubs we compile against.
   */
  const val PROMOTION_SDK_FULL = 3_600_001

  /** Asks for promotion only where the OS has it and the user has left Live Updates on. */
  fun requestsPromotion(sdkFull: Int, userAllowsPromotion: Boolean) =
    sdkFull >= PROMOTION_SDK_FULL && userAllowsPromotion

  /** A notification the user swiped away stays away for that workout; the next workout posts again. */
  fun mayPost(dismissedWorkoutId: String?, workoutId: String) = dismissedWorkoutId != workoutId

  /** A notification left to itself clears after this; a workout open longer than this posts nothing. */
  const val MAX_AGE_MS = 6L * 60 * 60 * 1000

  fun isStale(startedAt: Long, nowMs: Long) = startedAt > 0 && nowMs - startedAt > MAX_AGE_MS

  /** When to repost so the notification stops counting down: the rest's end, if it is still ahead. */
  fun restEndAlarmAt(status: WorkoutStatus, nowMs: Long): Long? =
    status.restEndsAt?.takeIf { status.phase == WorkoutStatusPresenter.RESTING && it > nowMs }

  /** A tap is honoured once: its nonce (the post time) must be newer than the last one acted on. */
  fun isFreshOpen(nonce: Long, lastConsumed: Long) = nonce > lastConsumed
}
