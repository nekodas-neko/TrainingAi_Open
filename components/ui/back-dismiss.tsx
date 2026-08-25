"use client";

import { useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useSheetBackDismiss } from "@/lib/hooks/use-sheet-back-dismiss";

/**
 * BF-27: the Android back gesture closes the sheet or dialog on top, instead of navigating the
 * page underneath it away.
 *
 * **It lives here rather than at 45 call sites** because that is where the repo puts UI defaults —
 * a tap-target floor belongs in `button.tsx`, not in every caller — and because a per-site wiring
 * is a rule every future sheet has to remember. Before this, 5 of 45 sheets and 0 of 6 dialogs
 * handled it.
 *
 * **It must be a child of `Content`, not a call in `SheetContent` itself.** `SheetContent`'s body
 * runs whenever its caller renders — every screen renders its sheets unconditionally with a null
 * prop — and it is `Portal` that gates the inner tree on `open`. A hook called one level up would
 * push a history entry for every closed sheet on the page.
 *
 * **Closing goes through Radix's own `onOpenChange`**, by clicking a hidden `Close`, rather than
 * through a close callback threaded in from the call site. So back takes the same path as the X
 * button and every guard already on it still runs — `config-screen`'s unsaved-work check, the
 * feedback sheet's reset, each dialog's cancel arm. It reaches the three sheets that pass
 * `hideCloseButton` too, since this Close is its own element and not the visible one.
 */
export function BackDismiss() {
  const ref = useRef<HTMLButtonElement>(null);
  // `true`, not an `open` prop: this only ever mounts while the surface is open, so mount is open
  // and unmount is close. The hook's effect keys on that.
  useSheetBackDismiss(true, () => ref.current?.click());
  return <DialogPrimitive.Close ref={ref} hidden aria-hidden tabIndex={-1} />;
}
