"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@trainingai/shared/utils";

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "relative inline-flex h-5 w-9 flex-none cursor-pointer items-center rounded-full border-2 border-transparent",
        // Radix's Switch root IS a <button>, so the global 48px tap-target floor in globals.css
        // wins over h-5/w-9 and renders this as a 48×48 `rounded-full` **black circle** rather than
        // a pill. `tap-dense` opts out of the floor and `before:` puts the touch area back as an
        // invisible 48px box centred on the pill — so the control looks right and stays reachable.
        // Fixing it here rather than per-call-site: the floor belongs to the shared component, and
        // every existing <Switch> (the goal-recommendation sheet among them) had the same bug.
        "tap-dense before:absolute before:left-1/2 before:top-1/2 before:size-12 before:-translate-x-1/2 before:-translate-y-1/2 before:content-['']",
        "shadow-sm outline-none transition-colors duration-200",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-white shadow-md ring-0",
          "transition-transform duration-200",
          "data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0",
          "dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
