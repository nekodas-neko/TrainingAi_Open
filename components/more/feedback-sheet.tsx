"use client";

import { useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@trainingai/shared/utils";
import { ImageIcon, XIcon } from "lucide-react";
import { downscaleToJpegDataUrl } from "@/lib/media/downscale-image";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FeedbackType = "bug" | "feature" | "other";

const TYPE_LABELS: Record<FeedbackType, string> = {
  bug: "Bug",
  feature: "Feature Request",
  other: "Other",
};

// Was a local copy that scaled by WIDTH only, so a portrait screenshot — which is what this app
// produces, at 412 × 915 — kept its full height and most of its bytes. The shared helper fits the
// longest edge (BF-4).
const SCREENSHOT_MAX_DIM = 800;

export function FeedbackSheet({ open, onOpenChange }: Props) {
  const [type, setType] = useState<FeedbackType | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function reset() {
    setType(null);
    setTitle("");
    setDescription("");
    setScreenshot(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await downscaleToJpegDataUrl(file, { maxDim: SCREENSHOT_MAX_DIM, quality: 0.7 });
      setScreenshot(compressed);
    } catch {
      toast.error("Failed to process image");
    }
    e.target.value = "";
  }

  async function handleSubmit() {
    if (!type || !title.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, title: title.trim(), description: description.trim() || null, screenshotData: screenshot }),
      });
      if (!res.ok) throw new Error();
      toast.success("Feedback submitted — thank you!");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to submit feedback");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}>
      <SheetContent side="bottom" className="rounded-t-2xl max-h-[90vh] flex flex-col">
        <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
          <SheetTitle>Submit Feedback</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Type chips */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-2">Type</p>
            <div className="flex gap-2">
              {(["bug", "feature", "other"] as FeedbackType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={cn(
                    "flex-1 rounded-lg py-2 text-xs font-medium border transition-colors",
                    type === t
                      ? "bg-foreground text-background border-foreground"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  {TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {/* Title */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Title <span className="text-destructive">*</span></p>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Brief description"
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {/* Description */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Details <span className="text-muted-foreground font-normal">(optional)</span></p>
            <textarea
              rows={4}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual behaviour, ideas…"
              className="w-full rounded-xl bg-muted/60 border border-border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none"
            />
          </div>

          {/* Screenshot */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">Screenshot <span className="text-muted-foreground font-normal">(optional)</span></p>
            {screenshot ? (
              <div className="relative inline-block">
                {/* eslint-disable-next-line @next/next/no-img-element -- data-URL screenshot, variable size */}
                <img src={screenshot} alt="Screenshot" className="rounded-xl max-h-40 object-contain border border-border" />
                <button
                  type="button"
                  onClick={() => setScreenshot(null)}
                  className="absolute -top-2 -right-2 rounded-full bg-destructive text-destructive-foreground w-5 h-5 flex items-center justify-center"
                >
                  <XIcon className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                <ImageIcon className="w-4 h-4" />
                Attach screenshot
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />
          </div>
        </div>

        <div className="p-4 pt-0 shrink-0">
          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={!type || !title.trim() || submitting}
          >
            {submitting ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
