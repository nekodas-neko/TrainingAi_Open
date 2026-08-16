"use client";

import { EyeOffIcon } from "lucide-react";
import { cn } from "@trainingai/shared/utils";
import type { ReactNode } from "react";

interface Props {
  id: string;
  editMode: boolean;
  onHide?: (id: string) => void;
  children: ReactNode;
}

export function HomeSortableSection({ id, editMode, onHide, children }: Props) {
  return (
    <div className="relative">
      {editMode && onHide && (
        <button
          onClick={() => onHide(id)}
          className="absolute right-5 top-1/2 -translate-y-1/2 z-10 rounded-lg p-1 text-muted-foreground/60 hover:text-muted-foreground active:scale-90 transition"
          aria-label="Hide section"
        >
          <EyeOffIcon className="h-4 w-4" />
        </button>
      )}
      <div className={cn(editMode && "pr-7 transition-[padding]")}>
        {children}
      </div>
    </div>
  );
}
