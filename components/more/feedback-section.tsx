"use client";

import { useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";
import { FeedbackSheet } from "./feedback-sheet";

export function FeedbackSection() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div>
        <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Feedback
        </p>
        <div className="rounded-2xl bg-muted/40 border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/60 transition"
          >
            <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-muted shrink-0">
              <MessageSquarePlusIcon className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="text-left">
              <p className="text-sm font-semibold">Report an Issue</p>
              <p className="text-[10px] text-muted-foreground">Found a bug or have a feature idea? Let us know.</p>
            </div>
          </button>
        </div>
      </div>

      <FeedbackSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
