import { cn } from "@trainingai/shared/utils";

export function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("animate-pulse rounded-xl bg-muted/50", className)} {...props} />;
}
