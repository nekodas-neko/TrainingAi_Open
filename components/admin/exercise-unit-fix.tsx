"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { toast } from "sonner";
import { Loader2, AlertTriangle } from "lucide-react";

interface UnitFixSetChange {
  setNumber: number;
  reps: number;
  oldWeightKg: number;
  newWeightKg: number;
}

interface UnitFixLogChange {
  exerciseLogId: string;
  exerciseName: string;
  loggedAt: string;
  oldEstimated1rm: number | null;
  newEstimated1rm: number | null;
  oldVolume: number | null;
  newVolume: number | null;
  sets: UnitFixSetChange[];
}

interface UnitFixExerciseSummary {
  exerciseName: string;
  oldPersonalRecord: number | null;
  newPersonalRecord: number | null;
}

interface UnitFixResult {
  logs: UnitFixLogChange[];
  exercises: UnitFixExerciseSummary[];
}

export default function ExerciseUnitFix() {
  const [exerciseNames, setExerciseNames] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [beforeDate, setBeforeDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [result, setResult] = useState<UnitFixResult | null>(null);
  const [applied, setApplied] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    fetch("/api/admin/fix-exercise-units")
      .then(res => res.json())
      .then(data => setExerciseNames(data.exerciseNames ?? []))
      .catch(() => toast.error("Failed to load exercise names"));
  }, []);

  function toggleExercise(name: string) {
    setResult(null);
    setApplied(false);
    setSelected(prev => prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]);
  }

  async function runPreview() {
    if (selected.length === 0 || !beforeDate) return;
    setLoading(true);
    setApplied(false);
    try {
      const res = await fetch("/api/admin/fix-exercise-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseNames: selected, beforeDate, apply: false }),
      });
      if (!res.ok) throw new Error();
      setResult(await res.json());
    } catch {
      toast.error("Failed to compute preview");
    } finally {
      setLoading(false);
    }
  }

  async function applyFix() {
    if (!result || selected.length === 0 || !beforeDate) return;
    setConfirmOpen(false);

    setApplying(true);
    try {
      const res = await fetch("/api/admin/fix-exercise-units", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseNames: selected, beforeDate, apply: true }),
      });
      if (!res.ok) throw new Error();
      setResult(await res.json());
      setApplied(true);
      toast.success("Weights converted");
    } catch {
      toast.error("Failed to apply fix");
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium mb-1">Fix lbs logged as kg</p>
        <p className="text-xs text-muted-foreground">
          Select the exercise(s) that were logged in lbs but recorded as kg, and the date
          before which this applies. Set weights, estimated 1RM, target 80%, volume and the
          personal record will be recalculated for affected sessions.
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {exerciseNames.map(name => {
          const active = selected.includes(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => toggleExercise(name)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                active ? "border-brand bg-brand/10 text-brand" : "border-border text-muted-foreground"
              }`}
              style={active ? { borderColor: "var(--color-brand)", color: "var(--color-brand)" } : undefined}
            >
              {name}
            </button>
          );
        })}
        {exerciseNames.length === 0 && (
          <p className="text-xs text-muted-foreground">No logged exercises found.</p>
        )}
      </div>

      <div>
        <Label htmlFor="unit-fix-before-date" className="text-xs text-muted-foreground">
          Convert sessions logged before
        </Label>
        <Input
          id="unit-fix-before-date"
          type="date"
          value={beforeDate}
          onChange={e => { setBeforeDate(e.target.value); setResult(null); setApplied(false); }}
          className="mt-1"
        />
      </div>

      <Button onClick={runPreview} disabled={loading || selected.length === 0 || !beforeDate}>
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Preview"}
      </Button>

      {result && (
        <div className="space-y-3 rounded-lg border p-3">
          {result.logs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No sessions found for the selected exercise(s) before {beforeDate}.
            </p>
          ) : (
            <>
              <div className="space-y-1">
                {result.exercises.map(ex => (
                  <p key={ex.exerciseName} className="text-xs">
                    <span className="font-medium">{ex.exerciseName}</span> PR:{" "}
                    {ex.oldPersonalRecord ?? "—"}kg → {ex.newPersonalRecord ?? "—"}kg
                  </p>
                ))}
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {result.logs.map(log => (
                  <div key={log.exerciseLogId} className="rounded border px-2 py-1.5 text-xs">
                    <p className="font-medium">
                      {log.exerciseName} — {new Date(log.loggedAt).toLocaleDateString()}
                    </p>
                    <p className="text-muted-foreground">
                      Sets: {log.sets.map(set => `${set.oldWeightKg}→${set.newWeightKg}kg×${set.reps}`).join(", ")}
                    </p>
                    <p className="text-muted-foreground">
                      1RM: {log.oldEstimated1rm ?? "—"} → {log.newEstimated1rm ?? "—"}kg
                      {" · "}Volume: {log.oldVolume ?? "—"} → {log.newVolume ?? "—"}kg
                    </p>
                  </div>
                ))}
              </div>

              {!applied ? (
                <Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={applying}>
                  {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <>
                      <AlertTriangle className="h-4 w-4 mr-1.5" />
                      Apply — converts {result.logs.length} session(s)
                    </>
                  )}
                </Button>
              ) : (
                <p className="text-sm text-green-600">Applied — {result.logs.length} session(s) converted.</p>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Convert these weights to kg?"
        message={result
          ? `Convert ${result.logs.length} session(s) for ${selected.join(", ")} logged before ${beforeDate} from lbs to kg? This cannot be undone automatically.`
          : ""}
        confirmLabel="Convert"
        onConfirm={applyFix}
      />
    </div>
  );
}
