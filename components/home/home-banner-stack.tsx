'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import type { ReadinessScoreResponse } from '@/app/api/readiness-score/route'
import { IllnessAdvisoryBanner } from '@/components/home/illness-advisory-banner'
import { EarlyDeloadCard } from '@/components/home/early-deload-card'
import { GoalsCheckinCard } from '@/components/home/goals-checkin-card'
import { WeeklyRecapBanner } from '@/components/weekly-recap-banner'
import { DismissibleBanner } from '@/components/ui/dismissible-banner'
import { HomeBannerPresenceProvider, useReportBannerPresence } from '@/components/home/home-banner-presence'
import { HomeBannerStrip } from '@/components/home/home-banner-strip'

const ExerciseDetectedCard = dynamic(
  () => import('@/components/activity/exercise-detected-card').then(m => ({ default: m.ExerciseDetectedCard })),
  { ssr: false },
)

interface Props {
  readiness: ReadinessScoreResponse | null
  earlyDeloadDismissed: boolean
  onEarlyDeloadConfirm: () => void
  onEarlyDeloadDismiss: () => void
  onExerciseDetectedReview: (sessionId: string) => void
  showGoalsCheckin: boolean
  onGoalsReviewNow: () => Promise<void>
  onGoalsRemindLater: () => void
  dayReviewDismissed: boolean
  onDayReviewActivate: () => void
  onDayReviewDismiss: () => void
}

/**
 * RV-119 — Home's banners, split by severity instead of stacked by arrival.
 *
 * Built to [`docs/design/2026-09-28-home-banner-stack.html`](../../docs/design/2026-09-28-home-banner-stack.html)
 * option **A**, picked by the owner 2026-09-28.
 *
 * **The failure was cumulative.** Seven banners each self-hid and each was individually correct; on
 * a Monday after a detected walk with an early-deload flag the owner scrolled past five cards to
 * reach the recommendation, which is the thing he opens Home for. The APK banner had already been
 * removed, leaving six.
 *
 * **Two stay full-width, and the split is by severity, not by height.** The illness advisory and the
 * early-deload warning are things he should see *today*; collapsing them into a row beside a weekly
 * recap is how they get missed. The other four are all the same kind of thing — "ready for you" —
 * which is what makes grouping them honest rather than a trick to save space.
 *
 * **The four stay MOUNTED while collapsed, hidden rather than unrendered.** Two of them decide their
 * own visibility internally, so this is what lets the strip know which are waiting — and it is also
 * what keeps their own dismiss controls alive. The entry lists losing those as the accepted cost of
 * option A; expanding shows the real banners, so it is not paid.
 *
 * ⚠ **Body Battery deliberately stays in the parent**, between the illness advisory and this stack:
 * it is a card the owner reads, not a notification, and the entry's list never included it.
 */
export function HomeBannerStack(props: Props) {
  // The provider has to wrap the component that REPORTS, so the reporting half is a child. Without
  // this split the stack would be rendering the context it needs to consume.
  return (
    <HomeBannerPresenceProvider>
      <HomeBannerStackInner {...props} />
    </HomeBannerPresenceProvider>
  )
}

function HomeBannerStackInner({
  readiness,
  earlyDeloadDismissed, onEarlyDeloadConfirm, onEarlyDeloadDismiss,
  onExerciseDetectedReview,
  showGoalsCheckin, onGoalsReviewNow, onGoalsRemindLater,
  dayReviewDismissed, onDayReviewActivate, onDayReviewDismiss,
}: Props) {
  const [expanded, setExpanded] = useState(false)

  // ⚠ These two are PARENT-controlled, so unlike the self-hiding pair they never get to report for
  // themselves — when their condition is false they are not rendered at all. Reported here instead,
  // from the one place that knows. Missing this undercounts the strip silently: it still renders,
  // just with fewer icons and a smaller number, which looks like a correct quiet day.
  useReportBannerPresence('goalsCheckin', showGoalsCheckin)
  useReportBannerPresence('dayReview', !dayReviewDismissed)

  return (
    <>
      {/* ── Full-width, by severity ─────────────────────────────────────────────────────────── */}
      {readiness?.earlyDeloadRecommended && !earlyDeloadDismissed && (
        <div className="mx-4 mb-3">
          <EarlyDeloadCard
            onConfirm={onEarlyDeloadConfirm}
            onDismiss={onEarlyDeloadDismiss}
            reason={readiness.earlyDeload}
          />
        </div>
      )}

      {/* ── The strip, and the four it stands for ───────────────────────────────────────────── */}
      <HomeBannerStrip expanded={expanded} onToggle={() => setExpanded(e => !e)} />

      {/* `hidden`, never unmounted: unmounting would take the four out of the presence registry the
          strip counts, and would throw away any state they hold. `hidden` is a Tailwind class here,
          not the HTML attribute, so it is a plain `display: none`. */}
      <div
        data-testid="home-banner-collapsed"
        className={expanded ? undefined : 'hidden'}
        aria-hidden={!expanded}
      >
        <div className="mx-4">
          <ExerciseDetectedCard onReview={onExerciseDetectedReview} />
        </div>

        {showGoalsCheckin && (
          <div className="mx-4 mb-3">
            <GoalsCheckinCard onReviewNow={onGoalsReviewNow} onRemindLater={onGoalsRemindLater} />
          </div>
        )}

        {!dayReviewDismissed && (
          <DismissibleBanner
            title="Your day in review is ready"
            // Q-112a — one door. This opened a second, thinner review only Home had; the real one
            // lives on Nutrition, with the meal types, logs and targets it needs.
            onActivate={onDayReviewActivate}
            onDismiss={onDayReviewDismiss}
          />
        )}

        <WeeklyRecapBanner />
      </div>
    </>
  )
}

export { IllnessAdvisoryBanner }
