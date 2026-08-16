"use client";

import { useRouter } from "next/navigation";
import { AlertTriangleIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FIELD_LABEL } from "@/lib/coach/patch";
import type { ChangePreviewArgs } from "@/lib/coach/widgets";
import { stashPendingChange } from "@/lib/coach/pending-change";

interface Tier3CardProps {
  args: ChangePreviewArgs;
  toolCallId: string;
  disabled?: boolean;
}

/**
 * The in-thread stub for a tier-3 change.
 *
 * It deliberately does **not** show a toggle or an Apply button. A change that can move you
 * backwards through a block you have already earned should not be one tap away in a scrolling
 * conversation — the full consequence list, and the hold-to-confirm, live on the pushed screen.
 * This card's only job is to say what is being proposed and get you there.
 */
export function Tier3Card({ args, toolCallId, disabled }: Tier3CardProps) {
  const router = useRouter();

  function review() {
    stashPendingChange({ toolCallId, title: args.title, patch: args.patch });
    router.push(`/coach/confirm/${toolCallId}`);
  }

  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/[0.06] overflow-hidden">
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-destructive/20">
        <AlertTriangleIcon className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span className="text-[11px] font-semibold tracking-wide text-destructive">
          Affects your whole block
        </span>
      </div>

      <div className="px-3.5 py-3">
        <p className="text-[13.5px] font-semibold mb-1">{args.title}</p>
        <p className="text-[12px] text-muted-foreground">
          {args.patch.changes.map(c => FIELD_LABEL[c.field]).join(", ")} ·{" "}
          {args.patch.changes.length} change{args.patch.changes.length === 1 ? "" : "s"}
        </p>
      </div>

      {!disabled && (
        <div className="px-3.5 pb-3.5">
          <Button variant="outline" className="w-full h-12 justify-between" onClick={review}>
            Review what this does
            <ChevronRightIcon className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
