"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUserTimezone } from "@/components/shell/user-timezone-provider";
import { saveManualNight, removeManualNight } from "@/lib/sleep/save-manual-night";
import { manualSleepImplausibleReason } from "@trainingai/shared/validation/plausibility";
import { msToHHMMInTz } from "@trainingai/shared/date-utils";
import { formatHoursMinutes } from "@trainingai/shared/format/units";
import { manualNightWindow } from "./manual-bedtime";

/** A night the user entered by hand, as the Sleep screen's rows carry it. */
export interface TypedNight {
  id: string
  sleepStart: string
  sleepEnd: string
}

interface Props {
  userId: string
  /** The wake date the card is for (`YYYY-MM-DD`, the user's "today"): last night's wake date. */
  wakeDate: string
  /** The night already logged by hand, or null when nothing is logged for last night. */
  night: TypedNight | null
  /** Called after a save or a removal landed, so the screen re-reads its rows. */
  onChanged: () => void
}

/**
 * Issue 2338 — log last night by hand, on the Sleep screen. The caller mounts this ONLY when last
 * night has no device night (the approved mockup, `docs/design/2026-10-07-manual-sleep-entry.html`):
 *
 * 1. nothing logged — a bed time and a wake time and "Save night";
 * 2. logged by hand — the window, with Edit and Remove night.
 *
 * Editing re-opens the same two fields prefilled and saves again; the same night saved twice is one
 * night (the writer keeps the date's row id), so Edit is just a second save. Every write goes through
 * `saveManualNight` / `removeManualNight`, which write the local store and the outbox on the device.
 * The instants are built from the two clocks in the USER's timezone, and the plausibility rule the
 * server enforces (`manualSleepImplausibleReason`) is checked first, so its reason shows under the
 * fields instead of coming back as a failed save.
 */
export function ManualNightCard({ userId, wakeDate, night, onChanged }: Props) {
  const tz = useUserTimezone();
  const [editing, setEditing] = useState(false);
  const [bed, setBed] = useState("");
  const [woke, setWoke] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const showFields = night == null || editing;

  const startEdit = () => {
    if (!night) return;
    setBed(msToHHMMInTz(night.sleepStart, tz));
    setWoke(msToHHMMInTz(night.sleepEnd, tz));
    setError(null);
    setEditing(true);
  };

  const onSave = async () => {
    if (busy) return;
    if (!bed || !woke) {
      setError("Enter the time you went to bed and the time you woke up.");
      return;
    }
    const win = manualNightWindow(wakeDate, bed, woke, tz);
    if (!win) {
      setError("Enter times like 23:10 and 06:40.");
      return;
    }
    const reason = manualSleepImplausibleReason(
      { sleepStart: new Date(win.sleepStart), sleepEnd: new Date(win.sleepEnd) },
      new Date(),
    );
    if (reason) {
      setError(`That night cannot be saved: ${reason}.`);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await saveManualNight({ userId, tz, ...win });
      if (!res.ok) {
        setError(`That night cannot be saved: ${res.reason}.`);
        return;
      }
      setEditing(false);
      if (res.shadowed) {
        toast.message("Saved, but a ring or Health Connect night for this date is being used instead.");
      } else {
        toast.success(night ? "Night updated" : "Night saved");
      }
      onChanged();
    } catch {
      setError("Could not save that night. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    if (!night || busy) return;
    setBusy(true);
    try {
      const res = await removeManualNight({ userId, id: night.id });
      if (!res.ok) {
        toast.error(res.reason);
        return;
      }
      setEditing(false);
      toast.success("Night removed");
      onChanged();
    } catch {
      toast.error("Could not remove that night");
    } finally {
      setBusy(false);
    }
  };

  const minutes = night ? (new Date(night.sleepEnd).getTime() - new Date(night.sleepStart).getTime()) / 60_000 : 0;

  return (
    <div
      data-testid="manual-night-card"
      className={`rounded-xl border p-4 ${night && !editing ? "border-border bg-muted/20" : ""}`}
      style={night && !editing ? undefined : {
        borderColor: "color-mix(in oklch, var(--accent-purple) 45%, transparent)",
        background: "color-mix(in oklch, var(--accent-purple) 10%, transparent)",
      }}
    >
      <p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Last night
        {night && (
          <span className="rounded-full border border-border px-2 py-0.5 text-[11px] font-normal normal-case tracking-normal">
            Logged by hand
          </span>
        )}
      </p>

      {showFields ? (
        <>
          {night == null && (
            <>
              <p className="text-base font-semibold">No night recorded</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Nothing came in from a ring or Health Connect. Log it by hand and it counts towards readiness.
              </p>
            </>
          )}
          <div className="mt-3 grid grid-cols-2 gap-2.5">
            <div className="space-y-1">
              <Label htmlFor="manual-night-bed" className="text-[10px] uppercase tracking-wider text-muted-foreground">Bed</Label>
              <Input
                id="manual-night-bed"
                type="time"
                value={bed}
                onChange={e => { setBed(e.target.value); setError(null); }}
                className="min-h-11 tabular-nums"
                aria-invalid={error != null}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="manual-night-woke" className="text-[10px] uppercase tracking-wider text-muted-foreground">Woke</Label>
              <Input
                id="manual-night-woke"
                type="time"
                value={woke}
                onChange={e => { setWoke(e.target.value); setError(null); }}
                className="min-h-11 tabular-nums"
                aria-invalid={error != null}
              />
            </div>
          </div>
          {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button className="min-h-11" onClick={() => void onSave()} disabled={busy}>
              {busy ? "Saving…" : "Save night"}
            </Button>
            {night && (
              <Button variant="outline" className="min-h-11" onClick={() => { setEditing(false); setError(null); }} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p className="text-base font-semibold tabular-nums">
            {msToHHMMInTz(night!.sleepStart, tz)} – {msToHHMMInTz(night!.sleepEnd, tz)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatHoursMinutes(minutes)} in bed. No sleep stages or heart rate, because nothing measured this night.
            A device night for the same date replaces it.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" className="min-h-11" onClick={startEdit} disabled={busy}>Edit</Button>
            <Button variant="ghost" className="min-h-11 text-muted-foreground" onClick={() => setConfirmRemove(true)} disabled={busy}>
              Remove night
            </Button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Remove this night?"
        message="The night you logged by hand is taken out of your sleep and readiness. Nothing a ring or Health Connect recorded is touched."
        confirmLabel="Remove night"
        onConfirm={() => { setConfirmRemove(false); void onRemove(); }}
      />
    </div>
  );
}
