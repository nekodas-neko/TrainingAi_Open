"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangleIcon, CheckIcon, ChevronLeftIcon, ClockIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_LABEL } from "@/lib/coach/patch";
import type { Consequence, Drift } from "@/lib/coach/consequences";
import { readPendingChange, clearPendingChange, type PendingChange } from "@/lib/coach/pending-change";

/** How long the button must be held. Long enough to be a decision, short enough not to be a fight. */
const HOLD_MS = 1200;

const ICON = { warn: AlertTriangleIcon, info: ClockIcon, good: CheckIcon } as const;
const COLOR = {
  warn: "var(--accent-amber)",
  info: "var(--muted-foreground)",
  good: "var(--accent-green)",
} as const;

/**
 * The tier-3 confirmation.
 *
 * A full screen rather than a card in the thread, because this is the only tier whose effects can
 * take something away — changing the cycle length or the phase set can move you backwards through
 * a block you have already earned. Hold-to-confirm rather than tap, and the action is the one
 * destructive-coloured control in the whole feature.
 */
export function ConfirmContent({ toolCallId }: { toolCallId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingChange | null | undefined>(undefined);
  const [consequences, setConsequences] = useState<Consequence[]>([]);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [holdPct, setHoldPct] = useState(0);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const holdTimer = useRef<number | null>(null);
  const inFlight = useRef(false);

  // Read once, in an effect rather than a lazy initializer — a storage read during render is the
  // documented hydration-mismatch pattern in this codebase.
  useEffect(() => {
    setPending(readPendingChange(toolCallId));
  }, [toolCallId]);

  useEffect(() => {
    if (!pending) return;
    let cancelled = false;
    fetch("/api/coach/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending.patch),
    })
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (cancelled || !data) return;
        setConsequences(data.consequences ?? []);
        setDrift(data.drift ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [pending]);

  function startHold() {
    if (applying || drift.length > 0) return;
    const started = Date.now();
    holdTimer.current = window.setInterval(() => {
      const pct = Math.min(1, (Date.now() - started) / HOLD_MS);
      setHoldPct(pct);
      if (pct >= 1) {
        stopHold();
        void apply();
      }
    }, 16);
  }

  function stopHold() {
    if (holdTimer.current !== null) {
      clearInterval(holdTimer.current);
      holdTimer.current = null;
    }
    setHoldPct(0);
  }

  useEffect(() => () => stopHold(), []);

  async function apply() {
    if (!pending || inFlight.current) return;
    inFlight.current = true;
    setApplying(true);
    setError(null);
    try {
      const res = await fetch("/api/coach/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patch: pending.patch,
          acceptedChangeIds: pending.patch.changes.map(c => c.id),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Could not apply the change");
        return;
      }
      clearPendingChange(toolCallId);
      router.back();
    } catch {
      setError("Could not reach the server");
    } finally {
      inFlight.current = false;
      setApplying(false);
    }
  }

  return (
    <div className="flex flex-col min-h-[100dvh] bg-page">
      <header className="flex-none flex items-center gap-2 px-3 pb-3 pt-safe-or-4">
        <button
          onClick={() => router.back()}
          aria-label="Back"
          className="h-12 w-12 rounded-xl grid place-items-center bg-muted/60 min-h-0"
        >
          <ChevronLeftIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-base font-bold tracking-tight">Review change</h1>
          <p className="text-[11px] text-muted-foreground">This affects your whole block</p>
        </div>
      </header>

      {pending === undefined ? null : !pending ? (
        <div className="px-4 pt-10 text-center">
          <p className="text-sm font-semibold mb-1">This suggestion has expired</p>
          <p className="text-[13px] text-muted-foreground mb-6">
            Proposals aren&apos;t kept across a reload, so nothing was applied. Ask Coach again and
            it&apos;ll work it out from where things stand now.
          </p>
          <Button variant="outline" className="h-12" onClick={() => router.back()}>
            Back to Coach
          </Button>
        </div>
      ) : (
        <>
          <div className="px-4">
            <p className="text-[15px] font-bold tracking-tight mb-3">{pending.title}</p>
            <div className="rounded-2xl border border-border overflow-hidden">
              {pending.patch.changes.map(c => (
                <div key={c.id} className="px-3.5 py-3 border-b border-border/40 last:border-b-0">
                  <p className="text-[9.5px] font-mono tracking-[0.14em] text-muted-foreground mb-1">
                    {FIELD_LABEL[c.field].toUpperCase()}
                  </p>
                  <p className="text-[13.5px] tabular-nums">
                    <span className="line-through text-muted-foreground">{String(c.from ?? "—")}</span>
                    <span className="text-muted-foreground mx-2">→</span>
                    <span className="font-semibold">{String(c.to)}</span>
                  </p>
                </div>
              ))}
            </div>
          </div>

          {consequences.length > 0 && (
            <div className="px-4 pt-5">
              <p className="text-[9.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground mb-2">
                What this does
              </p>
              {consequences.map((c, i) => {
                const Icon = ICON[c.kind];
                return (
                  <div key={i} className="flex items-start gap-2.5 py-1.5">
                    <Icon className="h-3.5 w-3.5 flex-none mt-0.5" style={{ color: COLOR[c.kind] }} />
                    <span className="text-[12.5px] text-muted-foreground leading-snug">{c.text}</span>
                  </div>
                );
              })}
            </div>
          )}

          {drift.length > 0 && (
            <div className="mx-4 mt-5 rounded-lg px-3 py-2.5 bg-[color-mix(in_oklch,var(--accent-amber)_12%,transparent)]">
              <p className="text-[12px]" style={{ color: "var(--accent-amber)" }}>
                This suggestion is out of date — {drift[0].field} is now {drift[0].actual}, not{" "}
                {drift[0].expected}. Ask Coach again for a fresh one.
              </p>
            </div>
          )}

          {error && (
            <div className="mx-4 mt-5 rounded-lg px-3 py-2.5 bg-destructive/10">
              <p className="text-[12px] text-destructive">{error}</p>
            </div>
          )}

          <div className="flex-1" />

          <div className="px-4 pt-6 pb-safe-action-lg">
            <div className="flex gap-2.5">
              <Button variant="outline" className="flex-1 h-14" onClick={() => router.back()} disabled={applying}>
                Cancel
              </Button>
              <button
                onPointerDown={startHold}
                onPointerUp={stopHold}
                onPointerLeave={stopHold}
                onPointerCancel={stopHold}
                disabled={applying || drift.length > 0}
                className="flex-[1.6] h-14 rounded-xl relative overflow-hidden border border-destructive/50 text-destructive font-semibold text-[13.5px] disabled:opacity-40"
              >
                {/* The fill is the timer. A hold with no feedback is a button that appears broken. */}
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 bg-destructive/25 transition-none"
                  style={{ width: `${holdPct * 100}%` }}
                />
                <span className="relative">
                  {applying ? <Loader2Icon className="h-4 w-4 animate-spin mx-auto" /> : "Hold to apply"}
                </span>
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground text-center mt-2.5">
              Undoable until your next workout
            </p>
          </div>
        </>
      )}
    </div>
  );
}
