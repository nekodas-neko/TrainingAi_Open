import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ActivityScreen } from "@/components/activity/activity-screen";

export default async function ActivityPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <div className="h-screen w-full">
      <ActivityScreen userId={session.user.id} />
    </div>
  );
}
