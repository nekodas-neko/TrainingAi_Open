"use client";

import { HealthScoreDetail } from "@/components/health/health-score-detail";
import { MetricScale } from "@/components/health/metric-scale";
import { volumeTargetKg } from "@trainingai/shared/health/activity-score";

export function ActivityContent({ userId }: { userId?: string }) {
  return (
    <HealthScoreDetail
      userId={userId}
      theme="activity"
      title="Activity"
      aiSection="activity"
      scoreField="activityScore"
      trendField="activityScore"
      contributorsField="activityContributors"
      sparklineColor="#f97316"
      contributorsTitle="Activity Contributors"
      extraCards={(data) => (
        <>
          {data.activitySignals && data.activityGoals && (
            <div className="rounded-xl border border-border bg-muted/20 p-4 space-y-4">
              {(data.activitySignals.steps != null || data.activitySignals.activeCalories != null) && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Today&apos;s activity vs your goals</p>
                  <div className="space-y-3">
                    <MetricScale
                      label="Steps"
                      value={data.activitySignals.steps}
                      min={0}
                      max={data.activityGoals.stepGoal}
                      optimal="high"
                      accent="#f97316"
                      format={(v) => Math.round(v).toLocaleString()}
                    />
                    <MetricScale
                      label="Active energy"
                      value={data.activitySignals.activeCalories}
                      min={0}
                      max={data.activityGoals.activeEnergyGoal}
                      optimal="high"
                      accent="#f97316"
                      format={(v) => `${Math.round(v)} kcal`}
                    />
                  </div>
                </>
              )}

              {(data.activitySignals.zoneMinutes != null || data.activitySignals.moveHours != null) && (
                <>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">Active minutes today</p>
                  <div className="space-y-3">
                    <MetricScale
                      label="Zone minutes"
                      value={data.activitySignals.zoneMinutes}
                      min={0}
                      max={data.activityGoals.zoneMinutesGoal}
                      optimal="high"
                      accent="#f97316"
                      format={(v) => `${Math.round(v)} min`}
                    />
                    <MetricScale
                      label="Hours moved"
                      value={data.activitySignals.moveHours}
                      min={0}
                      max={data.activityGoals.moveHoursGoal ?? 15}
                      optimal="high"
                      accent="#f97316"
                      format={(v) => `${Math.round(v)}`}
                    />
                  </div>
                </>
              )}

              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground pt-1">This week&apos;s training (rolling 7 days)</p>
              <div className="space-y-3">
                <MetricScale
                  label="Sessions"
                  value={data.activitySignals.sessions7d}
                  min={0}
                  max={data.activityGoals.strengthFreqGoal}
                  optimal="high"
                  accent="#f97316"
                  format={(v) => `${Math.round(v)}`}
                />
                <MetricScale
                  label="Volume"
                  value={data.activitySignals.volume7dKg}
                  min={0}
                  max={volumeTargetKg(data.activityGoals)}
                  optimal="high"
                  accent="#f97316"
                  format={(v) => `${Math.round(v)} kg`}
                />
              </div>

              {data.activityTaperApplied && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-center">
                  <p className="text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">Eased back today</span> — your recent training load is above the optimal range, so the score tapers rather than maxing out.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* stressHigh/recoveryHigh are seconds. The readiness route serves live derived
              daytime-stress values (10c) when available and gates the frozen-Cloud fallback
              behind the 2026-07-07 re-key — so these tiles light up from derived data and
              stay hidden (null) only when neither source has a value. Keep null-hides. */}
          {data.stressHigh != null && data.recoveryHigh != null && (
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Stress</p>
                <p className="text-xl font-bold tabular-nums mt-1">{Math.round(data.stressHigh / 60)} <span className="text-xs font-normal text-muted-foreground">min</span></p>
              </div>
              <div className="rounded-xl border border-border bg-muted/20 p-4 text-center">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Recovery</p>
                <p className="text-xl font-bold tabular-nums mt-1">{Math.round(data.recoveryHigh / 60)} <span className="text-xs font-normal text-muted-foreground">min</span></p>
              </div>
            </div>
          )}
        </>
      )}
    />
  );
}
