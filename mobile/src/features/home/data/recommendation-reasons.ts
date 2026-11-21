import {
  DELOAD_STRENGTH_HEADLINE,
  deloadBannerMessage,
  deloadCauseLine,
  deloadReasons,
  showsDeloadBanner,
  type DeloadReason,
  type DeloadReasonInput,
  type DeloadStrength,
} from '@trainingai/shared/ai-periodization/deload-reasons';
import { restDayGuidance, type RestDayGuidance } from '@trainingai/shared/health/rest-day-guidance';
import { currentSleepScore } from '@trainingai/shared/health/sleep-card-night';
import { formatMinutesOfDay } from '@trainingai/shared/date-utils';
import type { RecommendationModel } from './recommendation-model.ts';

// What Home's recommendation card says about a suggested rest (#3644, pick A) and which controls it
// shows (#2204, pick A). Every word comes from the daily check's answer (`computeAiDynamicNextSession`
// on the server), through the shared `deload-reasons` the current app also reads. The stored AI plan
// never says "rest" (#3718).

export type StripIcon = 'thermometer' | 'alert' | 'moon';
export type RecommendationStrip = { message: string; strength: DeloadStrength; icon: StripIcon };

/** The strip over today's card, or null. It shows before the check-in and on a suggested day's
 *  card, never over a session already trained, in progress, or a chosen rest. */
export function recommendationStrip(
  rec: DeloadReasonInput | null | undefined,
  model: RecommendationModel,
): RecommendationStrip | null {
  const open =
    model.kind === 'checkin' || (model.kind === 'session' && model.state === 'recommended');
  return open ? dailyCheckStrip(rec) : null;
}

/** The strip on its own, for the pre-workout screen, which shows today's call above the toggle. */
export function dailyCheckStrip(rec: DeloadReasonInput | null | undefined): RecommendationStrip | null {
  if (!rec || !showsDeloadBanner(rec)) return null;
  const strength = rec.deloadStrength ?? 'soft';
  return {
    message: deloadBannerMessage(rec),
    strength,
    icon: rec.temperatureAlert ? 'thermometer' : strength === 'strong' ? 'alert' : 'moon',
  };
}

export type DeloadWhy = {
  /** "Body temp elevated" or "N sessions in a row" beside the two choices; null for a soft nudge. */
  cause: string | null;
  headline: string;
  reasons: DeloadReason[];
};

/** What the card says under "Why this recommendation?" on a day the check suggests rest. */
export function deloadWhy(rec: DeloadReasonInput): DeloadWhy {
  return {
    cause: deloadCauseLine(rec),
    headline: DELOAD_STRENGTH_HEADLINE[rec.deloadStrength ?? 'recommended'],
    reasons: deloadReasons(rec),
  };
}

export type RestDayReadiness = {
  readinessDisplayScore?: number | null;
  sleepScore?: number | null;
  sleepScoreDate?: string | null;
  recommendedBedtimeStart?: number | null;
} | null | undefined;

export type RestDayCardModel = RestDayGuidance & { bedtime: string | null };

/** The Rest Day card's guidance, from the shared `restDayGuidance` the current app's card uses. */
export function restDayCardModel(input: {
  readiness: RestDayReadiness;
  soreMuscles: readonly string[];
  consecutiveRestDays: number | null | undefined;
  today: string;
}): RestDayCardModel {
  const guidance = restDayGuidance({
    readinessScore: input.readiness?.readinessDisplayScore ?? null,
    soreMuscles: [...input.soreMuscles],
    // #3667: an older night's score is not last night's.
    sleepScore: currentSleepScore(input.readiness ?? null, input.today),
    consecutiveRestDays: input.consecutiveRestDays,
  });
  const start = input.readiness?.recommendedBedtimeStart;
  return {
    ...guidance,
    bedtime: guidance.band === 'rest' && start != null ? formatMinutesOfDay(start) : null,
  };
}

/**
 * The card's controls. On an ordinary day Start is the one control and a swipe reveals Rest; on a
 * day the check suggests rest, Rest and Full stay side by side, one tap each.
 */
export type RecommendationControls = 'resume' | 'completed' | 'rest-and-full' | 'start-swipe-rest';

export function recommendationControls(
  action: Extract<RecommendationModel, { kind: 'session' }>['action'],
): RecommendationControls {
  if (action === 'resume') return 'resume';
  if (action === 'completed') return 'completed';
  return action === 'deload' ? 'rest-and-full' : 'start-swipe-rest';
}
