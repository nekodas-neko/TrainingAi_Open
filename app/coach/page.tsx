import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { DEFAULT_TZ } from "@trainingai/shared/date-utils";
import { CoachContent } from "./coach-content";

export const metadata = { title: "AI Coach" };

export default async function CoachPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  // Threaded from the session, never read from the device — a date rendered in the phone's zone is
  // invisible until the phone leaves the zone the data was recorded in.
  return <CoachContent tz={session.user.timezone ?? DEFAULT_TZ} />;
}
