import * as React from "react";

import { cn } from "@trainingai/shared/utils";

/**
 * What a `type="number"` field needs so its text can actually centre (BF-85).
 *
 * Chromium draws the inner spin button INSIDE the box, so a `text-center` value centres in what is
 * left of the field and reads visibly off-centre — which is what the owner saw on the Assign step,
 * on an input that already carried `text-center`.
 *
 * A constant rather than a third hand-copy: `quantity-editor.tsx` and `assign-step.tsx` are two
 * sites for one job, and CLAUDE.md extracts at the third. It is a class string rather than a
 * component because **only 1 of the 28 `type="number"` inputs in the app uses the `Input`
 * primitive** — the other 27 are bare `<input>`, including both of these — so a fix that lived only
 * in the component would reach almost nothing. Measured 2026-09-01; BF-85's own recommendation
 * assumed otherwise.
 */
export const NUMBER_INPUT_RESET =
  "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Free for anything converted to the primitive later; today it reaches one call site.
        type === "number" && NUMBER_INPUT_RESET,
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground dark:bg-input/30 border-input flex h-9 w-full min-w-0 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
