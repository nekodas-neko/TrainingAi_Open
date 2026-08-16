import type { LucideIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({ icon: Icon, title, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center gap-2 py-8 text-center", className)}>
      {Icon && <Icon className="h-6 w-6 text-muted-foreground/60" />}
      <p className="text-sm text-muted-foreground">{title}</p>
      {action}
    </div>
  );
}
