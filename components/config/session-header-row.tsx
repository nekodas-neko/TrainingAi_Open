"use client";

import type { RefObject } from "react";
import { GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@trainingai/shared/utils";
import { FITNESS_ICONS, getSessionIcon } from "@/lib/session-icon";
import type { EditableSession } from "@/components/config/program-editor-sheet";

interface SessionHeaderRowProps {
  session: EditableSession;
  index: number;
  handleRef: (el: HTMLElement | null) => void;
  iconPickerOpen: boolean;
  onIconPickerToggle: () => void;
  iconPickerRef: RefObject<HTMLDivElement | null>;
  onIconChange: (icon: string) => void;
  onNameChange: (name: string) => void;
  canDelete: boolean;
  onRequestDelete: () => void;
}

/** The drag handle, icon picker, name field and delete control at the top of a session card. */
export function SessionHeaderRow({
  session,
  index,
  handleRef,
  iconPickerOpen,
  onIconPickerToggle,
  iconPickerRef,
  onIconChange,
  onNameChange,
  canDelete,
  onRequestDelete,
}: SessionHeaderRowProps) {
  const Icon = getSessionIcon(session.icon, index);
  return (
    <div className="flex items-center gap-2">
      <button
        ref={el => handleRef(el)}
        type="button"
        className="cursor-grab active:cursor-grabbing touch-none flex-none"
        aria-label="Reorder session"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground/40" />
      </button>
      <div className="relative flex-none">
        <button
          type="button"
          onClick={onIconPickerToggle}
          className="tap-dense tap-target-44 w-9 h-9 flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted transition"
          title="Pick icon"
        >
          <Icon className="h-5 w-5 text-muted-foreground" />
        </button>
        {iconPickerOpen && (
          <div
            ref={iconPickerRef}
            className="absolute left-0 top-10 z-50 rounded-xl border border-border bg-popover shadow-lg p-2 grid grid-cols-5 gap-1 w-48"
          >
            {FITNESS_ICONS.map(({ emoji, Icon: OptionIcon, label }) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onIconChange(emoji)}
                title={label}
                className={cn(
                  "tap-dense tap-target-dot w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted transition",
                  session.icon === emoji && "bg-brand/20 ring-1 ring-brand"
                )}
              >
                <OptionIcon className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </div>
        )}
      </div>
      <Input
        value={session.name}
        onChange={e => onNameChange(e.target.value)}
        placeholder="Session name (e.g. Push)"
        className="text-sm font-semibold flex-1"
      />
      {canDelete && (
        <button
          onClick={onRequestDelete}
          className="rounded-lg p-2 text-muted-foreground hover:text-destructive transition flex-none"
          title="Remove session"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
