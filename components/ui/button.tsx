import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@trainingai/shared/utils";

/**
 * RV-71 — the press state, and why `transition-all` was the wrong half of the fix.
 *
 * This primitive is imported by 129 files and had **no `active:` anywhere**: every variant was
 * `hover:`-only. On a touch-only product that is the most-tapped control in the app giving no
 * feedback at all — and on Android WebView `hover:` either never resolves or **sticks after a tap**,
 * so a button could be left looking permanently highlighted. Meanwhile 45 files hand-roll
 * `active:scale` (`set-card.tsx` at 0.90, `streak-card.tsx` at 0.95), so the pattern was already the
 * house style and the shared control was the one missing it.
 *
 * **`transition-all` is narrowed in the same change, and that is not tidying.** It animates `width`,
 * `height`, `padding` and `margin` too, so any Button whose size changes — a label swapping to a
 * spinner, a count appearing — silently got a layout animation nobody asked for. The list here is
 * the properties a button actually changes.
 *
 * `motion-reduce:` opts both out. `MotionConfig reducedMotion="user"` at `app/layout.tsx` covers
 * Framer Motion components; a CSS transition is not one, so it needs saying here.
 *
 * **Not established:** nothing was measured on device. The sticking-`hover:` behaviour is a
 * documented Android WebView trait, not something reproduced in this sandbox.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[transform,background-color,opacity,border-color,box-shadow] duration-100 active:scale-[0.97] motion-reduce:active:scale-100 motion-reduce:transition-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
        destructive:
          "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
        ghost:
          "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
