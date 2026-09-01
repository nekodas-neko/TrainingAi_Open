"use client";

import { useState } from "react";
import { MessageSquarePlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FeedbackSheet } from "./feedback-sheet";

/** BF-82: this used to be a hand-written copy of `MoreRowGroup` — a "FEEDBACK" heading over a
 *  bordered card holding one button — which is the single-row-group shape the More tab had seven
 *  more of. It opens a sheet rather than navigating, so it belongs with the other bottom actions
 *  (Edit profile, Sign out), not among the navigation rows. */
export function FeedbackSection() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="ghost" className="w-full" onClick={() => setOpen(true)}>
        <MessageSquarePlusIcon className="w-4 h-4 mr-2" />
        Report an Issue
      </Button>

      <FeedbackSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
