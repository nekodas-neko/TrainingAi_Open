import { cn } from "@trainingai/shared/utils";

interface BottomActionBarProps {
  children: React.ReactNode;
  /** true when the bottom nav is visible on this screen (adds nav clearance). */
  aboveNav?: boolean;
  className?: string;
}

/** Fixed bottom container for primary actions. Owns gesture-bar clearance. */
export function BottomActionBar({ children, aboveNav = false, className }: BottomActionBarProps) {
  return (
    <div
      className={cn(
        "fixed left-0 right-0 z-40 bg-background/95 backdrop-blur-sm border-t border-border/60 px-4 pt-3",
        aboveNav ? "bottom-nav-safe pb-3" : "bottom-0 pb-safe-action",
        className,
      )}
    >
      {children}
    </div>
  );
}
