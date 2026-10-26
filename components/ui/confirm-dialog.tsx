"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { phraseMatches } from "@/components/ui/confirm-phrase";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "destructive" | "default";
  /**
   * When set, the confirm button stays disabled until this exact phrase is typed. For actions that
   * cannot be undone by any means — a stray tap on a plain confirm is still one tap from the loss.
   */
  confirmPhrase?: string;
  /**
   * `email` is for a phrase that is an email address (#3369): matched without case, and the field is
   * a lowercase email field instead of the uppercase phrase field.
   */
  confirmPhraseKind?: "phrase" | "email";
  /** Receives what was typed, trimmed, so the server can check it itself. */
  onConfirm: (typed: string) => void;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "destructive",
  confirmPhrase,
  confirmPhraseKind = "phrase",
  onConfirm,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  // Clear what was typed on every close, so reopening never starts already unlocked.
  const handleOpenChange = (next: boolean) => {
    if (!next) setTyped("");
    onOpenChange(next);
  };
  const isEmail = confirmPhraseKind === "email";
  const unlocked = phraseMatches(typed, confirmPhrase, isEmail);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{message}</p>
        {confirmPhrase !== undefined && (
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={isEmail ? "Type their email" : `Type ${confirmPhrase}`}
            aria-label={`Type ${confirmPhrase} to confirm`}
            autoCapitalize={isEmail ? "none" : "characters"}
            inputMode={isEmail ? "email" : undefined}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm"
          />
        )}
        <div className="flex gap-2 mt-2">
          <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant}
            className="flex-1"
            disabled={!unlocked}
            onClick={() => {
              if (!unlocked) return;
              const value = typed.trim();
              setTyped("");
              onConfirm(value);
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
