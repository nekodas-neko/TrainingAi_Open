import { auth } from "@/auth";
import { redirect } from "next/navigation";
import WorkoutSelectContent from "./workout-select-content";
import { BottomNav } from "@/components/shell/bottom-nav";

export default async function WorkoutSelectPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");

  return (
    <>
      <WorkoutSelectContent />
      <BottomNav isAdmin={session.user.isAdmin} />
    </>
  );
}
