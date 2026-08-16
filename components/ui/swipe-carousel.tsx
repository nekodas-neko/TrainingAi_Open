"use client";

import { useRef, useState } from "react";
import { useDrag } from "@use-gesture/react";
import { useReducedMotion } from "motion/react";
import { cn } from "@trainingai/shared/utils";
import { applyEdgeResistance, commitTarget } from "./swipe-carousel-math";

interface SwipeCarouselProps {
  index: number;
  onIndexChange: (index: number) => void;
  children: React.ReactNode[]; // one node per panel, each rendered w-full flex-none
  className?: string;
  lazyMount?: boolean; // only mount current ± 1 panels
}

// Walk up from the gesture's start target to (but not past) the carousel root, looking for a
// descendant that scrolls horizontally on its own (Trends pill strip, chart pagers — anything
// `overflow-x: auto/scroll` with content wider than its box). A horizontal swipe that begins
// inside one of those belongs to *it*, not the tab carousel — otherwise dragging the pills also
// flips Body/Training/Progress (CLAUDE.md: document-level gesture recognizers must exclude
// scrollable ancestors generally, not just tagged carousels).
function startsInHorizontalScroller(target: EventTarget | null, root: HTMLElement | null): boolean {
  let node = target as HTMLElement | null;
  while (node && node !== root) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const ox = getComputedStyle(node).overflowX;
      if (ox === "auto" || ox === "scroll") return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function SwipeCarousel({ index, onIndexChange, children, className, lazyMount }: SwipeCarouselProps) {
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const reduced = useReducedMotion();
  const count = children.length;
  const rootRef = useRef<HTMLDivElement>(null);

  const bind = useDrag(
    ({ movement: [mx], velocity: [vx], last, first, event, cancel }) => {
      if (first && startsInHorizontalScroller(event.target, rootRef.current)) {
        cancel();
        return;
      }
      if (first) setDragging(true);
      if (!last) {
        setDragX(applyEdgeResistance(mx, index, count));
        return;
      }
      setDragging(false);
      setDragX(0);
      const target = commitTarget(mx, index, vx, count);
      if (target !== index) onIndexChange(target);
    },
    { axis: "x", filterTaps: true, pointer: { touch: true } },
  );

  return (
    <div
      {...bind()}
      ref={rootRef}
      data-swipe-carousel
      className={cn("overflow-hidden", className)}
      style={{ touchAction: "pan-y" }}
    >
      <div
        className="flex h-full"
        style={{
          transform: `translateX(calc(${-index * 100}% + ${dragX}px))`,
          transition: dragging || reduced ? "none" : "transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94)",
          willChange: "transform",
        }}
      >
        {children.map((child, i) => (
          <div key={i} className="w-full flex-none h-full">
            {lazyMount && Math.abs(i - index) > 1 ? null : child}
          </div>
        ))}
      </div>
    </div>
  );
}
