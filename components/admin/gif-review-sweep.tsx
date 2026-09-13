"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Check, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/**
 * BF-147 — judge the catalogue's GIFs one at a time.
 *
 * Owner, on the Admin Console → Exercises tab: *"I also want a better way to make sure everything
 * has the right gif. Maybe a way for me to flag if its wrong so we can decide how to proceed."*
 *
 * **A list is the wrong instrument and that is the whole reason this screen exists.** Verifying
 * ~150 GIFs by scrolling 40 px thumbnails cannot be done — the thing being judged is whether the
 * animation shows the movement, which needs the GIF large. One at a time, big, with the name and
 * the target muscles beside it, sweeps the catalogue in a sitting.
 *
 * **Marking one wrong fires no AI call.** The route is deliberately inert for the same reason:
 * *"so we can decide how to proceed"* asks for a **set** to decide about, and regenerating on the
 * spot would destroy the evidence of what was wrong with it.
 */

export interface ReviewCandidate {
  name: string;
  gifUrl: string;
  muscles: string[];
  equipment: string[];
}

type Verdict = "ok" | "wrong";

export function GifReviewSweep({
  open,
  onOpenChange,
  candidates,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: ReviewCandidate[];
  onDone: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  // A fresh sweep each time it opens: the queue is rebuilt from what is still unreviewed, so
  // resuming mid-list would land on a position that no longer means anything.
  useEffect(() => {
    if (open) { setIndex(0); setVerdicts({}); }
  }, [open]);

  const current = candidates[index];
  const wrongCount = useMemo(
    () => Object.values(verdicts).filter(v => v === "wrong").length,
    [verdicts],
  );

  async function judge(status: Verdict) {
    if (!current || saving) return;
    setSaving(true);
    try {
      const res = await fetch("/api/admin/exercise-media-review", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseName: current.name, gender: "male", status }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }
      setVerdicts(prev => ({ ...prev, [current.name]: status }));
      setIndex(i => i + 1);
    } catch (err) {
      // Never advance on a failure: skipping past an unrecorded verdict is how a sweep ends up
      // claiming to have covered the catalogue when it has not.
      toast.error(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  }

  const done = !current;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="flex h-[92vh] flex-col" bottomInset="takeover" hideCloseButton>
        <SheetHeader className="flex-none">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-base">
              {done ? "Sweep complete" : `Reviewing ${index + 1} of ${candidates.length}`}
            </SheetTitle>
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { onDone(); onOpenChange(false); }}>
              {done ? "Close" : "Finish later"}
            </Button>
          </div>
          {candidates.length > 0 && (
            <div className="mt-2 h-1 w-full rounded-full bg-muted">
              <div
                className="h-1 rounded-full bg-primary transition-all"
                style={{ width: `${Math.round((index / candidates.length) * 100)}%` }}
              />
            </div>
          )}
        </SheetHeader>

        {done ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm font-medium">
              {candidates.length === 0
                ? "Nothing left to review."
                : `Judged ${candidates.length}, flagged ${wrongCount} as wrong.`}
            </p>
            <p className="text-xs text-muted-foreground">
              The flagged ones are recorded against each exercise&apos;s media row — nothing was regenerated.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-2">
              <div className="relative aspect-square w-full max-w-[300px] overflow-hidden rounded-2xl bg-white">
                {/* `unoptimized` because it is a GIF: /_next/image would serve a still frame, and a
                    still frame cannot answer whether the movement is the right one. */}
                <Image
                  key={current.name}
                  src={current.gifUrl}
                  alt={`GIF for ${current.name}`}
                  fill
                  sizes="300px"
                  unoptimized
                  className="object-contain"
                />
              </div>
              <div className="text-center">
                <p className="text-base font-semibold">{current.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {current.muscles.join(", ") || "No muscles recorded"}
                  {current.equipment.length > 0 && ` · ${current.equipment.join(", ")}`}
                </p>
              </div>
            </div>

            <div className="flex flex-none gap-2 px-4">
              <Button
                variant="outline"
                className="h-12 flex-1 gap-1.5 border-destructive/40 text-destructive"
                disabled={saving}
                onClick={() => judge("wrong")}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Wrong
              </Button>
              <Button
                className="h-12 flex-1 gap-1.5"
                disabled={saving}
                onClick={() => judge("ok")}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Looks right
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
