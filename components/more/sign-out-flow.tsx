"use client";

import { useCallback, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { signOutAndClearDevice } from "@/lib/sign-out";
import { prepareSignOut, type PrepareSignOutResult, type SignOutSyncOutcome, type UnsentLine } from "@/lib/sign-out-pending";

/**
 * Issue 2532, surface half. Owner decision (2026-10-07): sync first, then warn; nothing is discarded
 * silently. This is the ONE place that signs out from a screen: it runs `prepareSignOut`, signs out
 * at once when nothing is unsent, and otherwise asks. `signOutAndClearDevice()` is unchanged and
 * only called from here ("Sign out anyway", or a clean sync). A source-scan test fails any other
 * caller. The account-delete sheet reuses the list and wording below.
 */

/** Why the changes are still here, in plain words. Empty for 'synced'. */
export function unsentOutcomeNote(outcome: SignOutSyncOutcome): string {
  switch (outcome) {
    case "offline": return "You're offline, so they can't sync right now.";
    case "timeout": return "Syncing took too long, so they're still on this phone.";
    case "partial": return "The server didn't take all of them. Sync now to try again.";
    default: return "";
  }
}

export function UnsentChangesList({ lines }: { lines: UnsentLine[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1 text-sm" aria-label="Changes that haven't synced">
      {lines.map(l => <li key={l.kind}>{l.label}</li>)}
    </ul>
  );
}

export function changesHeadline(total: number): string {
  return `${total} ${total === 1 ? "change hasn't" : "changes haven't"} synced`;
}

export function useSignOutFlow(userId: string | undefined): {
  /** Tap handler for the Sign Out button. */
  start: () => void;
  /** True while syncing or signing out; the button shows "Syncing…". */
  busy: boolean;
  /** Render once, next to the button. */
  dialog: ReactNode;
} {
  const [phase, setPhase] = useState<"idle" | "syncing" | "signing-out">("idle");
  const [pending, setPending] = useState<PrepareSignOutResult | null>(null);

  const finish = useCallback(async () => {
    setPending(null);
    setPhase("signing-out");
    try {
      await signOutAndClearDevice();
    } catch {
      setPhase("idle");
    }
  }, []);

  const check = useCallback(async () => {
    setPhase("syncing");
    const res = userId ? await prepareSignOut(userId) : null;
    if (!res || res.lost.length === 0) {
      await finish();
      return;
    }
    setPending(res);
    setPhase("idle");
  }, [userId, finish]);

  const start = useCallback(() => {
    if (phase !== "idle") return;
    void check();
  }, [phase, check]);

  const syncing = phase === "syncing";
  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(next) => { if (!next && phase === "idle") setPending(null); }}>
      {pending && (
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{changesHeadline(pending.remaining.total)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Signing out now discards these, and they can&apos;t be recovered:
            </p>
            <UnsentChangesList lines={pending.lost} />
            {unsentOutcomeNote(pending.outcome) && (
              <p role="status" className="text-sm text-muted-foreground">{unsentOutcomeNote(pending.outcome)}</p>
            )}
          </div>
          <div className="flex flex-col gap-2 mt-4 pb-safe-action">
            <Button className="h-11" disabled={syncing} onClick={() => { void check(); }}>
              {syncing ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Syncing…</> : "Sync now"}
            </Button>
            <Button variant="destructive" className="h-11" disabled={syncing || phase === "signing-out"} onClick={() => { void finish(); }}>
              Sign out anyway
            </Button>
            <Button variant="ghost" className="h-11" disabled={syncing} onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );

  return { start, busy: phase !== "idle", dialog };
}
