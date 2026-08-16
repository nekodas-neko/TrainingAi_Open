import { cn } from "@trainingai/shared/utils";

interface ScreenHeaderProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children?: React.ReactNode; // custom content (Home's greeting row)
  className?: string;
  bordered?: boolean;
}

export function ScreenHeader({ title, subtitle, action, children, className, bordered = true }: ScreenHeaderProps) {
  return (
    <header className={cn("px-4 pt-safe pb-3 flex items-start justify-between gap-2", bordered && "border-b border-border", className)}>
      {children ?? (
        <div>
          {title && <h1 className="text-xl font-bold">{title}</h1>}
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </div>
      )}
      {action}
    </header>
  );
}
