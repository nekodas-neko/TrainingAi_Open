"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { phraseMatches } from "@/components/ui/confirm-phrase";
import { ACCOUNT_DELETION_PHRASE } from "@trainingai/shared/user/account-deletion";
import { deleteAccountAndSignOut } from "@/lib/account/delete-account";

const DELETED = [
  "Your profile and sign-in",
  "Workouts, programs, sets and personal records",
  "Food, supplement, body, mood and sleep logs",
  "Heart-rate and ring data stored on the server",
  "AI coach conversations, goals and insights",
  "Friends, season results and achievements",
  "The app's copy of your data on this phone, including anything not yet synced",
];

const KEPT = [
  "Error reports and AI usage records (time, model, token counts), with your account removed from them",
  "Exercises you added to the shared exercise list, without your name on them",
];

/**
 * #2120 — the one irreversible control in the app, so it asks for a TYPED phrase rather than a tap
 * (owner, 2026-09-24). The copy cites no store guideline: none was verified, and a wrong number in
 * front of a reviewer is worse than none.
 */
export function DeleteAccountSheet() {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [state, setState] = useState<"idle" | "deleting" | "deleted">("idle");
  const [error, setError] = useState<string | null>(null);
  const unlocked = phraseMatches(typed, ACCOUNT_DELETION_PHRASE);

  // A deletion in flight cannot be dismissed half-way, and closing always re-locks the button.
  const handleOpenChange = (next: boolean) => {
    if (state !== "idle") return;
    if (!next) {
      setTyped("");
      setError(null);
    }
    setOpen(next);
  };

  async function confirm() {
    if (!unlocked || state !== "idle") return;
    setState("deleting");
    setError(null);
    const outcome = await deleteAccountAndSignOut(typed.trim(), () => setState("deleted"));
    if (!outcome.ok) {
      setState("idle");
      setError(outcome.error);
    }
  }

  return (
    <>
      <Button variant="ghost" className="w-full text-muted-foreground" onClick={() => setOpen(true)}>
        <Trash2 className="w-4 h-4 mr-2" />
        Delete account
      </Button>

      <Sheet open={open} onOpenChange={handleOpenChange}>
        <SheetContent
          side="bottom"
          bottomInset="takeover"
          className="rounded-t-2xl max-h-[90dvh] flex flex-col"
          hideCloseButton={state !== "idle"}
        >
          <SheetHeader className="border-b border-border/30 pb-3 shrink-0">
            <SheetTitle>Delete your account</SheetTitle>
            <SheetDescription>
              This deletes your account and everything in it, straight away. It can&apos;t be undone.
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 space-y-4 text-sm">
            <section aria-labelledby="delete-account-deleted">
              <h3 id="delete-account-deleted" className="text-xs font-semibold text-muted-foreground mb-1.5">Deleted</h3>
              <ul className="list-disc pl-5 space-y-1">
                {DELETED.map(line => <li key={line}>{line}</li>)}
              </ul>
            </section>

            <section aria-labelledby="delete-account-kept">
              <h3 id="delete-account-kept" className="text-xs font-semibold text-muted-foreground mb-1.5">Kept</h3>
              <ul className="list-disc pl-5 space-y-1">
                {KEPT.map(line => <li key={line}>{line}</li>)}
              </ul>
            </section>

            <p>
              Your Oura ring stays paired to this phone. Deleting your account doesn&apos;t unpair it or clear its key.
            </p>

            <p className="text-muted-foreground">
              Want a copy first? Use <span className="font-medium text-foreground">Export my data</span> in
              More → Data &amp; Sync before you delete.
            </p>

            <div className="space-y-1.5">
              <Label htmlFor="delete-account-phrase" className="text-xs font-semibold text-muted-foreground">
                Type {ACCOUNT_DELETION_PHRASE} to confirm
              </Label>
              <Input
                id="delete-account-phrase"
                value={typed}
                onChange={e => setTyped(e.target.value)}
                disabled={state !== "idle"}
                placeholder={ACCOUNT_DELETION_PHRASE}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                className="h-11 font-mono"
              />
            </div>

            {error && <p role="alert" className="text-destructive">{error}</p>}
            {state === "deleted" && <p role="status">Your account has been deleted. Signing you out…</p>}
          </div>

          <div className="px-4 shrink-0">
            <Button
              variant="destructive"
              className="w-full h-11"
              disabled={!unlocked || state !== "idle"}
              onClick={() => { void confirm(); }}
            >
              {state === "idle" ? "Delete my account" : (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{state === "deleting" ? "Deleting…" : "Signing out…"}</>
              )}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
