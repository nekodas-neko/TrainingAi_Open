"use client";

import * as React from "react";
import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";

import { cn } from "@trainingai/shared/utils";
import { BackDismiss } from "@/components/ui/back-dismiss";
import { ScrimLayer } from "@/components/dynamic-background/scrim-layer";
import { screenPaletteVar } from "@/lib/background/screen-palettes";
import { useScreenSurfacePalette } from "@/lib/hooks/use-screen-surface";

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

/**
 * How much room a bottom sheet leaves under its own content, in one of two documented shapes.
 *
 * `action` uses `.pb-safe-action` — the inset against a 0.75rem floor, right for a short sheet over
 * a screen that still has the bottom nav.
 *
 * `takeover` uses `.pb-safe-action-lg`, and a sheet tall enough to BE the screen wants it. Under
 * Capacitor's edge-to-edge the WebView is drawn behind the nav bar, so the inset reports the bar's
 * own height — which means `action` pads by exactly the bar and leaves a primary button sitting
 * flush on it. That measurement is recorded beside the class in `globals.css`, and it is what the
 * owner reported on the meal detail sheet as *"the safe space is still a little off"* (BF-62). The
 * larger class adds a real gap on top of the inset, with a floor that keeps the no-inset look (web
 * QA, gesture nav reporting 0) unchanged.
 *
 * Set it HERE rather than adding `pb-safe*` inside the sheet: the sheet owns its bottom inset, and
 * an inner utility stacks on top of this one rather than replacing it.
 */
type BottomInset = "action" | "takeover";

/**
 * The screen's wallpaper palette, painted inside a `surface="page"` sheet (BF-75).
 *
 * **Painted rather than revealed, and the difference is not stylistic.** The obvious fix is to make
 * the sheet translucent, and it does not work: the wallpaper sits at `z-[-1]` while `SheetOverlay`
 * and `SheetContent` are both `z-50`, so a transparent sheet shows the overlay's `bg-black/50`, not
 * the tab behind it. Turning the overlay off instead would take the dimming that separates a modal
 * from the page — and on a dense sheet of macro numbers and ingredient rows that dimming is what
 * keeps the small grey secondary text legible.
 *
 * `-z-10` puts it above the sheet's own background and below its content: `SheetContent` is
 * `fixed z-50`, which establishes a stacking context, so a negative z-index inside it cannot escape
 * behind the sheet. Without it an `absolute` child paints ABOVE the non-positioned content and the
 * sheet renders as a blank gradient.
 *
 * The `ScrimLayer` is the DetailHero treatment, reused rather than re-tuned: body text on these
 * sheets must hold ≥4.5:1 and a raw gradient behind live text is what that rule exists to stop.
 */
function SheetSurfaceLayer() {
  const palette = useScreenSurfacePalette();
  // Null whenever the wallpaper itself is off — including the store's shipped default — so this is
  // a no-op rather than a coloured panel floating over a plain page.
  if (!palette) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
      style={{ background: screenPaletteVar(palette) }}
    >
      <ScrimLayer />
    </div>
  );
}

function SheetContent({
  className,
  children,
  side = "right",
  hideCloseButton = false,
  bottomInset = "action",
  surface = "default",
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  hideCloseButton?: boolean;
  bottomInset?: BottomInset;
  /**
   * `"page"` paints the screen's own wallpaper palette inside the sheet (BF-75), so a nutrition
   * pull-up carries the tab's colour instead of stopping the theme at its own edge.
   *
   * **Opt-in, never the default, and that is the whole shape of this feature.** `SheetContent` is
   * the app-wide primitive — every sheet in every tab renders through it — so a global change here
   * is the *"no global element-selector styling"* hazard wearing a component's clothes. A regression
   * has to be scoped to the screens that asked for it.
   */
  surface?: "default" | "page";
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-50 flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" && [
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
            // Chosen, never appended: tailwind-merge does not know these custom classes, so a later
            // `pb-safe-action-lg` would sit BESIDE `pb-safe-action` and the two would stack.
            bottomInset === "takeover" ? "pb-safe-action-lg" : "pb-safe-action",
          ],
          className,
        )}
        {...props}
      >
        {surface === "page" && <SheetSurfaceLayer />}
        <BackDismiss />
        {children}
        {!hideCloseButton && (
          <SheetPrimitive.Close className="ring-offset-background focus:ring-ring data-[state=open]:bg-secondary absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none">
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="sheet-header" className={cn("p-4", className)} {...props}>
      {/* The close button is `absolute top-4 right-4` on SheetContent with a 48px tap target, so it
          owns the rightmost 64px and anything a header puts there lands underneath it — measured on
          a 412px viewport: a "New Meal" button at x=300-408 under a close button at x=348-396.
          Two things this reservation has to survive, both learned by measuring a fix that did
          nothing. It lives on this INNER element because any call site passing `px-*` silently
          overrides an outer one (tailwind-merge, later class wins) and eight sheets do exactly
          that. And it is `pr-16`, not `pr-12`, because it is measured from the SheetContent edge
          while the outer padding is per-call-site — `px-1` here leaves only 4px, so a 48px
          reservation still ran 12px under the X. */}
      <div className="flex flex-col gap-1.5 pr-16">{children}</div>
    </div>
  );
}

function SheetFooter({
  className,
  bottomInset = "action",
  ...props
}: React.ComponentProps<"div"> & { bottomInset?: BottomInset }) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col gap-2 p-4",
        bottomInset === "takeover" ? "pb-safe-action-lg" : "pb-safe-action",
        className,
      )}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
