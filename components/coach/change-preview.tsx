"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangleIcon, CheckIcon, ClockIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@trainingai/shared/utils";
import { FIELD_LABEL, FIELD_UNIT, type PatchChange } from "@/lib/coach/patch";
import { GOAL_LOCAL_STORAGE_KEYS } from "@/lib/coach/domains/goals";
import { invalidateCoachHistory, invalidateGoalRecommendations } from "@/lib/cache-groups";
import type { ChangePreviewArgs } from "@/lib/coach/widgets";
import type { Consequence, Drift } from "@/lib/coach/consequences";

interface ChangePreviewProps {
  args: ChangePreviewArgs;
  onApplied?: (summary: string) => void;
  onCancel?: () => void;
  onStale?: (detail: string) => void;
  disabled?: boolean;
}

function renderValue(value: unknown, field: PatchChange["field"]): string {
  if (value === null || value === undefined || value === "") return "—";
  const unit = FIELD_UNIT[field] ?? "";
  // A bare number in a confirmation is ambiguous — 2340 what? Numbers get a thousands separator
  // and their unit; everything else prints as-is.
  if (typeof value === "number") return `${Math.round(value).toLocaleString()}${unit}`;
  // Every boolean field here is phrased as a question by its label ("Remove from session",
  // "Mark recovered", "Deload week"), so the answer belongs in the value. Printing the raw
  // `false → true` was the alternative, and it read like a debug dump.
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return `${value}${unit}`;
}

const CONSEQUENCE_ICON = {
  warn: AlertTriangleIcon,
  info: ClockIcon,
  good: CheckIcon,
} as const;

const CONSEQUENCE_COLOR = {
  warn: "var(--accent-amber)",
  info: "var(--muted-foreground)",
  good: "var(--accent-green)",
} as const;

/**
 * The only widget that writes.
 *
 * Consequences are fetched from `/api/coach/preview` rather than read out of the model's
 * arguments, so what the user sees under a proposal is a measurement of their own data. The model
 * cannot author a line here at all — the schema has no field for one.
 */
export function ChangePreview({ args, onApplied, onCancel, onStale, disabled }: ChangePreviewProps) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(args.patch.changes.map(c => [c.id, true])),
  );
  const [consequences, setConsequences] = useState<Consequence[] | null>(null);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Guards a double-tap on Apply. Five rapid taps once fired four complete-workout POSTs.
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/coach/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args.patch),
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        setConsequences(data.consequences ?? []);
        setDrift(data.drift ?? []);
      })
      .catch(() => {
        // A failed preview must not block the change — it costs the consequence list, not the
        // ability to act. Apply re-validates server-side regardless.
        if (!cancelled) setConsequences([]);
      });
    return () => {
      cancelled = true;
    };
  }, [args.patch]);

  const acceptedIds = args.patch.changes.filter(c => accepted[c.id]).map(c => c.id);
  const isStale = drift.length > 0;
  const inert = disabled || !onApplied;

  async function handleApply() {
    if (inFlight.current || acceptedIds.length === 0) return;
    inFlight.current = true;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patch: args.patch, acceptedChangeIds: acceptedIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        onStale?.(data.error ?? "This suggestion is out of date");
        setError(data.error ?? "This suggestion is out of date");
        return;
      }
      if (!res.ok) {
        setError(data.error ?? "Could not apply the change");
        return;
      }
      writeGoalsThrough(args.patch, acceptedIds);
      // Same omission Q-240 found on the Profile editor, on a third surface: the DB write landed
      // but `user-goals` kept serving its pre-change entry, so Health showed the old goal for up to
      // its TTL after Coach said the change was applied.
      if (args.patch.domain === "user_goals") invalidateGoalRecommendations().catch(() => {});
      // An applied change becomes a row in the Coach history list.
      invalidateCoachHistory().catch(() => {});
      onApplied?.(data.summary ?? "Change applied");
    } catch {
      setError("Could not reach the server");
    } finally {
      inFlight.current = false;
      setApplying(false);
    }
  }

  return (
    <div
      className={cn(
        "rounded-2xl border overflow-hidden",
        inert
          ? "border-dashed border-border bg-muted/20 opacity-60"
          : "border-[color-mix(in_oklch,var(--accent-purple)_28%,transparent)] bg-[color-mix(in_oklch,var(--accent-purple)_7%,transparent)]",
      )}
    >
      <div className="px-3.5 py-2.5 border-b border-border/60">
        <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">{args.title}</span>
      </div>

      <div>
        {args.patch.changes.map((change: PatchChange) => (
          <div key={change.id} className="flex items-center gap-3 px-3.5 py-3 border-b border-border/40">
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold">{FIELD_LABEL[change.field]}</div>
              <div className="text-[11.5px] mt-0.5 tabular-nums">
                {change.field === "removed" ? (
                  <span className="text-muted-foreground">Removed from the session</span>
                ) : (
                  <>
                    <span className="line-through text-muted-foreground">{renderValue(change.from, change.field)}</span>
                    <span className="text-muted-foreground mx-1.5">→</span>
                    <span className="font-semibold">{renderValue(change.to, change.field)}</span>
                  </>
                )}
              </div>
            </div>
            <Switch
              checked={accepted[change.id] ?? false}
              disabled={inert || applying || isStale}
              onCheckedChange={v => setAccepted(prev => ({ ...prev, [change.id]: v }))}
              aria-label={`Accept ${FIELD_LABEL[change.field]} change`}
            />
          </div>
        ))}
      </div>

      {consequences && consequences.length > 0 && (
        <div className="py-1.5">
          {consequences.map((c, i) => {
            const Icon = CONSEQUENCE_ICON[c.kind];
            return (
              <div key={i} className="flex items-start gap-2.5 px-3.5 py-1.5">
                <Icon className="h-3.5 w-3.5 flex-none mt-0.5" style={{ color: CONSEQUENCE_COLOR[c.kind] }} />
                <span className="text-[12px] text-muted-foreground leading-snug">{c.text}</span>
              </div>
            );
          })}
        </div>
      )}

      {isStale && (
        <div className="mx-3.5 mb-2 rounded-lg px-3 py-2 bg-[color-mix(in_oklch,var(--accent-amber)_12%,transparent)]">
          <p className="text-[12px]" style={{ color: "var(--accent-amber)" }}>
            This suggestion is out of date — {drift[0].field} is now {drift[0].actual}, not {drift[0].expected}. Ask
            again for a fresh one.
          </p>
        </div>
      )}

      {error && !isStale && (
        <div className="mx-3.5 mb-2 rounded-lg px-3 py-2 bg-destructive/10">
          <p className="text-[12px] text-destructive">{error}</p>
        </div>
      )}

      {!inert && (
        <div className="flex gap-2.5 px-3.5 pt-2 pb-3.5">
          <Button variant="outline" className="flex-1 h-12" onClick={onCancel} disabled={applying}>
            Cancel
          </Button>
          <Button
            className="flex-[1.5] h-12"
            onClick={handleApply}
            disabled={applying || isStale || acceptedIds.length === 0}
          >
            {applying ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : acceptedIds.length === args.patch.changes.length ? (
              "Apply"
            ) : (
              `Apply ${acceptedIds.length}`
            )}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Home's widgets and Profile's Goals section read these three values from **localStorage**, not the
 * database — `goal-recommendation-sheet.tsx` writes them through for exactly this reason. Without
 * the same write-through here, a goal Coach just changed would keep showing its old value until a
 * reload, which reads as the change not having worked.
 */
function writeGoalsThrough(patch: ChangePreviewArgs["patch"], acceptedIds: string[]) {
  if (patch.domain !== "user_goals") return;
  try {
    for (const change of patch.changes) {
      if (!acceptedIds.includes(change.id)) continue;
      const key = GOAL_LOCAL_STORAGE_KEYS[change.field];
      if (key) localStorage.setItem(key, String(Math.round(Number(change.to))));
    }
  } catch {
    // A blocked localStorage must not fail an applied change — the database write already landed.
  }
}
