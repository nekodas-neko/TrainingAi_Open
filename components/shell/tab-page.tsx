import { Suspense } from "react";
import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { TabShell } from "./tab-shell";
import type { TabKey } from "./tabs";

// Server half of every tab route: one auth() JWT decode, no DB, then the
// persistent client shell. The Suspense boundary covers the contents'
// useSearchParams reads during prerender.
export async function TabPage({ initialTab }: { initialTab: TabKey }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <Suspense fallback={null}>
      <TabShell
        initialTab={initialTab}
        session={{
          userId: session.user.id,
          isAdmin: session.user.isAdmin,
          friendCode: session.user.friendCode,
          sex: session.user.sex ?? null,
          heightCm: session.user.heightCm ?? null,
          dateOfBirth: session.user.dateOfBirth ?? null,
          activityLevel: session.user.activityLevel ?? null,
        }}
      />
    </Suspense>
  );
}
