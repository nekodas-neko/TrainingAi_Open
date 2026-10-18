import { isLearningContributor } from '@trainingai/shared/health/score-gap-copy';
import { labelFor } from './factor-label';

export type ContributorFactor = {
  key: string;
  label: string;
  score: number | null;
  /** Flagged provisional by the composite; picks the note under "What your score means". */
  provisional: boolean;
  /** No score of its own to show: learning its baseline, or nothing recorded (#3029). */
  learning: boolean;
  gap?: unknown;
  scale?: unknown;
  weight?: number;
  extra?: string;
  gauge?: number;
};

// The factor rows behind the contributors card, kept out of the component so they can be tested.
export function contributorFactors({
  contributors,
  weights,
  provisional = [],
  cases,
  extras,
  temperature,
}: {
  contributors: Record<string, number | null> | null | undefined;
  weights?: Record<string, number>;
  provisional?: string[];
  cases?: Record<string, { gap?: unknown; scale?: unknown }>;
  extras?: Record<string, string>;
  temperature?: number | null;
}): ContributorFactor[] {
  return Object.entries(
    weights
      ? Object.fromEntries(Object.keys(weights).map((key) => [key, contributors?.[key] ?? null]))
      : (contributors ?? {}),
  )
    .filter(([, v]) => weights || v !== null)
    .map(([key, score]) => {
      const flagged = provisional.includes(key);
      const gap = cases?.[key]?.gap;
      return {
        key,
        score,
        label: labelFor(key),
        provisional: score == null || flagged,
        learning: score == null || isLearningContributor({ provisional: flagged, gap }),
        gap,
        scale: cases?.[key]?.scale,
        weight: weights?.[key],
        extra: extras?.[key],
        gauge:
          key === 'temperature' && temperature != null
            ? Math.max(0, Math.min(100, ((temperature + 1.5) / 3) * 100))
            : undefined,
      };
    })
    .sort((a, b) => {
      const aa = a.learning ? null : a.score;
      const bb = b.learning ? null : b.score;
      return aa != null && bb != null
        ? aa - bb
        : aa != null
          ? -1
          : bb != null
            ? 1
            : (weights?.[b.key] ?? 0) - (weights?.[a.key] ?? 0);
    });
}
