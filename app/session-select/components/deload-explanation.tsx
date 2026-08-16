"use client";

import { useState } from "react";
import { ChevronDownIcon, ThermometerIcon, HeartPulseIcon, MoonIcon, FlameIcon, BatteryLowIcon, CalendarClockIcon, ActivityIcon } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { cn } from "@trainingai/shared/utils";
import type { NextSessionRecommendation } from "@trainingai/shared/types/program";
import { TEMP_BASELINE_MIN_DAYS } from "@trainingai/shared/ai-periodization/deload-constants";
import { temperatureBaselineProgress } from "./temperature-baseline-progress";

interface Signal {
  icon: React.ReactNode;
  text: string;
}

// Turn the recommendation's raw signal fields into a plain-English list of *why* recovery is
// being suggested — the home card only shows a one-line summary, which the owner found too thin.
function buildSignals(rec: NextSessionRecommendation): Signal[] {
  const out: Signal[] = [];
  const s = rec.signals;

  if (rec.temperatureAlert) {
    const dev = s?.temperatureDeviation;
    const threshold = s?.temperatureAlertThresholdC;
    const nights = s?.temperatureBaselineDays;
    const text = dev != null && threshold != null
      ? `+${dev.toFixed(1)}°C above your baseline (threshold ${threshold.toFixed(1)}°C)${nights != null ? ` — based on ${nights} nights of history.` : "."} Often an early sign of illness, incomplete recovery, or heat/alcohol stress.`
      : "Body temperature is above your baseline — often an early sign of illness, incomplete recovery, or heat/alcohol stress.";
    out.push({ icon: <ThermometerIcon className="h-3.5 w-3.5" />, text });
  }
  if (s?.ouraReadiness != null && s.ouraReadiness < 70) {
    out.push({
      icon: <ActivityIcon className="h-3.5 w-3.5" />,
      text: `Readiness ${Math.round(s.ouraReadiness)} — below the 70+ range where hard training is well tolerated.`,
    });
  }
  if (rec.hrvWarning || (s?.hrvTrend != null && s.hrvTrend < 0.85)) {
    out.push({
      icon: <HeartPulseIcon className="h-3.5 w-3.5" />,
      text: "HRV is trending down versus your recent baseline — a reliable marker that your nervous system is still recovering.",
    });
  }
  if (s?.sleepTrend != null && s.sleepTrend < 0.85) {
    out.push({
      icon: <MoonIcon className="h-3.5 w-3.5" />,
      text: "Recent sleep is short of your typical amount, so recovery capacity is reduced today.",
    });
  }
  if (rec.consecutiveTrainingDays != null && rec.consecutiveTrainingDays >= 3) {
    out.push({
      icon: <CalendarClockIcon className="h-3.5 w-3.5" />,
      text: `${rec.consecutiveTrainingDays} training days in a row without a rest day — fatigue accumulates faster than it clears.`,
    });
  }
  if (s?.energyLevel === "drained" || s?.energyLevel === "low") {
    out.push({
      icon: <BatteryLowIcon className="h-3.5 w-3.5" />,
      text: `You checked in feeling ${s.energyLevel === "drained" ? "drained" : "low on energy"} this morning.`,
    });
  }
  if (s?.soreMuscles && s.soreMuscles.length > 0) {
    out.push({
      icon: <FlameIcon className="h-3.5 w-3.5" />,
      text: `Still sore: ${s.soreMuscles.join(", ")}.`,
    });
  }
  return out;
}

const STRENGTH_HEADLINE: Record<NonNullable<NextSessionRecommendation["deloadStrength"]>, string> = {
  soft: "A light nudge to ease off — your call.",
  recommended: "Recovery is recommended today.",
  strong: "Strong signal to back off today.",
};

export function DeloadExplanation({ recommendation }: { recommendation: NextSessionRecommendation }) {
  const [open, setOpen] = useState(false);
  const signals = buildSignals(recommendation);
  const strength = recommendation.deloadStrength ?? "recommended";
  const baselineNights = temperatureBaselineProgress(recommendation.signals?.temperatureBaselineDays);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border border-border bg-muted/40">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="text-xs font-medium text-muted-foreground">Why this recommendation?</span>
        <ChevronDownIcon className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-3 pb-3">
          <p className="text-xs font-semibold text-foreground">{STRENGTH_HEADLINE[strength]}</p>

          {signals.length > 0 && (
            <ul className="space-y-2">
              {signals.map((sig, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground">
                  <span className="mt-0.5 flex-none text-foreground/70">{sig.icon}</span>
                  <span>{sig.text}</span>
                </li>
              ))}
            </ul>
          )}

          {baselineNights != null && (
            <p className="flex items-start gap-2 text-[11px] leading-snug text-muted-foreground/80">
              <ThermometerIcon className="mt-0.5 h-3.5 w-3.5 flex-none" />
              <span>
                Body temperature isn&apos;t being used yet — still learning your baseline
                ({baselineNights} of {TEMP_BASELINE_MIN_DAYS} nights). It needs a full month before a
                reading counts as unusual for you.
              </span>
            </p>
          )}

          <div className="space-y-1.5 border-t border-border/60 pt-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Your options</p>
            <Option color="#fbbf24" label="Deload" desc="Same session, lighter loads (~10–20% off). Keeps the movement and blood flow without adding fatigue." />
            <Option color="#818cf8" label="Rest" desc="Skip training. Full recovery — best when readiness is low or you feel run down." />
            <Option color="#22c55e" label="Full" desc="Train as prescribed. Choose this if you feel good despite the signals above." />
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function Option({ color, label, desc }: { color: string; label: string; desc: string }) {
  return (
    <div className="flex items-start gap-2 text-[11px] leading-snug">
      <span className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: color }} />
      <span className="text-muted-foreground">
        <span className="font-semibold text-foreground">{label}</span> — {desc}
      </span>
    </div>
  );
}
