import { WifiOffIcon } from "lucide-react";
import { OfflineActions } from "./offline-actions";

// Static + unauthenticated so it can be precached and served with no network and
// no session. MUST stay logic-free (no auth(), no data fetches) — any dependency
// here becomes its own offline failure mode.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="pt-safe flex min-h-screen flex-col items-center justify-center gap-5 bg-page px-6 text-center">
      <WifiOffIcon className="h-12 w-12 text-muted-foreground" />
      <div>
        <h1 className="text-xl font-bold">You&apos;re offline</h1>
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">
          This screen needs a connection. Your saved data is still on the other
          tabs — reconnect to load this one.
        </p>
      </div>
      <OfflineActions />
    </div>
  );
}
