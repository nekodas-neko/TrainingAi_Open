import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { CoachContent } from "./coach-content";

export const metadata = { title: "AI Coach" };

/**
 * `?scope=` names which coach this is (Q-407).
 *
 * A search param rather than a separate route: there is one coach, and the scope is a routing
 * convenience the API already treats as optional — an unknown or absent one falls back to `general`
 * rather than 400ing, so an old link and a new build cannot disagree fatally. It also means the
 * Nutrition tab's entry point is a plain link, which is what lets the stepper stay reachable beside
 * it instead of being replaced by it.
 */
export default async function CoachPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const { scope } = await searchParams;
  // Threaded from the session, never read from the device — a date rendered in the phone's zone is
  // invisible until the phone leaves the zone the data was recorded in.
  return (
    <CoachContent
      tz={session.user.timezone ?? DEFAULT_TZ}
      userId={session.user.id}
      scope={scope}
    />
  );
}
