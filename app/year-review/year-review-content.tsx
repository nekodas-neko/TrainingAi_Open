"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ChevronLeftIcon, ShareIcon } from "lucide-react";
import { cachedFetch, readCacheSync } from "@/lib/sqlite/cache";
import { TTL_LONG } from "@trainingai/shared/cache-ttl";
import type { YearReviewResponse } from "@/app/api/year-review/route";
import { useTransitionRouter } from "@/lib/view-transition";
import { displayOneRm, oneRmLabel } from "@trainingai/shared/1rm";

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthLabelsTrailing(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const idx = (now.getMonth() - (11 - i) + 24) % 12;
    return MONTH_LABELS[idx];
  });
}

function Section({ children }: { children: React.ReactNode }) {
  return (
    <section className="h-screen w-full snap-start flex flex-col items-center justify-center px-6 text-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.5 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-sm"
      >
        {children}
      </motion.div>
    </section>
  );
}

export function YearReviewContent({ userId }: { userId?: string }) {
  const router = useTransitionRouter();
  const [data, setData] = useState<YearReviewResponse | null>(() => {
    try {
      return readCacheSync<YearReviewResponse>("year-review");
    } catch {
      return null;
    }
  });

  useEffect(() => {
    cachedFetch<YearReviewResponse>("year-review", "/api/year-review", TTL_LONG, d => {
      if (d) setData(d);
    }).catch(() => {});
  }, [userId]);

  async function handleShare() {
    if (!data) return;
    const text = `My year on TrainingAI: ${data.sessionCount} sessions, ${Math.round(data.totalVolumeKg).toLocaleString()} kg moved, ${data.prCount} PRs 🏋️`;
    if (navigator.share) {
      await navigator.share({ text }).catch(() => {});
    } else {
      await navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  if (!data) {
    return (
      <div className="flex h-screen items-center justify-center bg-page">
        <p className="text-sm text-muted-foreground">Loading your year…</p>
      </div>
    );
  }

  const months = monthLabelsTrailing();
  const maxMonthCount = Math.max(1, ...data.monthlySessionCounts);
  const biggestExercise = data.topExercises[0];

  return (
    <div className="relative bg-page">
      <div className="fixed top-0 left-0 right-0 flex items-center px-2 pt-safe-or-4 pb-2 z-20">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="p-2 rounded-xl hover:bg-muted/40 transition-colors"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
      </div>

      <div className="h-screen overflow-y-auto scrollbar-hide snap-y snap-mandatory">
        <Section>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Your Year</p>
          <p className="text-2xl font-bold mb-1">You moved</p>
          <p className="text-6xl font-black tabular-nums" style={{ color: "var(--color-brand)" }}>
            {(data.totalVolumeKg / 1000).toFixed(1)}
          </p>
          <p className="text-lg font-semibold text-muted-foreground">tonnes</p>
        </Section>

        <Section>
          <p className="text-2xl font-bold mb-4">{data.sessionCount} sessions logged</p>
          <p className="text-5xl font-black tabular-nums mb-1" style={{ color: "var(--color-brand)" }}>
            {data.longestWeeklyStreak}
          </p>
          <p className="text-sm text-muted-foreground">week{data.longestWeeklyStreak !== 1 ? "s" : ""} — your longest training streak</p>
          <p className="text-xs text-muted-foreground mt-3">{data.totalSets.toLocaleString()} total sets · {Math.round(data.totalMinutes / 60).toLocaleString()} hours trained</p>
        </Section>

        {biggestExercise && (
          <Section>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Most trained</p>
            <p className="text-3xl font-bold mb-3">{biggestExercise.exerciseName}</p>
            <p className="text-sm text-muted-foreground mb-1">{biggestExercise.setCount} sets logged</p>
            {biggestExercise.first1rm != null && biggestExercise.last1rm != null && (
              <p className="text-lg font-semibold" style={{ color: "var(--color-brand)" }}>
                {displayOneRm(biggestExercise.first1rm, biggestExercise.exerciseType).text} → {displayOneRm(biggestExercise.last1rm, biggestExercise.exerciseType).text}{" "}
                {oneRmLabel(biggestExercise.exerciseType).toLowerCase()}
              </p>
            )}
          </Section>
        )}

        <Section>
          <p className="text-2xl font-bold mb-3">{data.prCount} personal records</p>
          {data.biggestPr && (
            <p className="text-sm text-muted-foreground">
              Biggest: <span className="font-semibold text-foreground">{data.biggestPr.exerciseName}</span> at{" "}
              <span className="font-semibold" style={{ color: "var(--color-brand)" }}>{displayOneRm(data.biggestPr.estimated1rm, data.biggestPr.exerciseType).text}</span>
            </p>
          )}
        </Section>

        <Section>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-4">Sessions per month</p>
          <div className="flex items-end justify-center gap-1.5 h-32 mb-3">
            {data.monthlySessionCounts.map((count, i) => (
              <div key={i} className="flex flex-col items-center gap-1 flex-1">
                <div
                  className="w-full rounded-t-md"
                  style={{
                    height: `${Math.max(4, (count / maxMonthCount) * 100)}%`,
                    background: count > 0 ? "var(--color-brand)" : "var(--muted)",
                  }}
                />
                <span className="text-[9px] text-muted-foreground">{months[i]}</span>
              </div>
            ))}
          </div>
          <button
            onClick={handleShare}
            className="mt-4 w-full flex items-center justify-center gap-2 rounded-xl bg-foreground text-background py-3 text-sm font-semibold"
          >
            <ShareIcon className="w-4 h-4" />
            Share your year
          </button>
        </Section>
      </div>
    </div>
  );
}
