package com.trainingai.app.scale

/**
 * Which of the five things a `POST /api/scale-ble/samples` answer means for the owner. Pulled out
 * of `ScaleBleService.postWeighIn` so the choice is testable without a Context: the service used to
 * branch on `pending` and `compositionSkipped` only, so a `dismissed` answer (a reading far outside
 * the account's band, kept out of the trend) fell through to "logged".
 *
 * The server's names are `status`, `compositionSkipped` and `isAdditionalReadingForDay`.
 */
enum class ScaleWeighInOutcome {
    LOGGED, ADDITIONAL, PENDING, COMPOSITION_SKIPPED, DECLINED;

    companion object {
        fun of(status: String, compositionSkipped: Boolean, isAdditionalReadingForDay: Boolean): ScaleWeighInOutcome =
            when {
                status == "pending" -> PENDING
                status == "dismissed" -> DECLINED
                compositionSkipped -> COMPOSITION_SKIPPED
                isAdditionalReadingForDay -> ADDITIONAL
                else -> LOGGED
            }
    }
}
