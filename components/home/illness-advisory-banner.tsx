"use client";

import { memo } from "react";
import { Thermometer } from "lucide-react";
import type { ReadinessScoreResponse } from "@/app/api/readiness-score/route";

// Compact Home advisory for the illness radar. Renders only at elevated/fever —
// watch stays on the readiness detail page. Static status banner (not a nested
// control inside the chip row); tapping through lives on the Readiness chip beside it.
export const IllnessAdvisoryBanner = memo(function IllnessAdvisoryBanner({
  readiness,
}: {
  readiness: ReadinessScoreResponse;
}) {
  if (readiness.illnessFlag !== "elevated" && readiness.illnessFlag !== "fever") return null;
  if (!readiness.illnessAdvisory) return null;
  return (
    <div
      role="status"
      className="mx-4 mb-3 flex items-start gap-2.5 rounded-2xl border border-border bg-muted/60 px-3 py-2.5"
    >
      <Thermometer className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden />
      <div className="text-[12px] leading-snug text-foreground">
        <span className="font-semibold capitalize">{readiness.illnessFlag}</span>
        {readiness.illnessSuppression > 0 && (
          <span className="text-muted-foreground"> · readiness −{readiness.illnessSuppression}</span>
        )}
        <span className="block text-muted-foreground">{readiness.illnessAdvisory}</span>
      </div>
    </div>
  );
});
