import { auth } from "@/auth";
import { redirect } from "next/navigation";
import WorkoutScreen from "@/components/workout-screen";
import { TabPage } from "@/components/shell/tab-page";

interface WorkoutPageProps {
  searchParams: Promise<{ session?: string; aiDeload?: string; wasOverride?: string }>;
}

export default async function WorkoutPage({ searchParams }: WorkoutPageProps) {
  const { session: sessionId, aiDeload, wasOverride } = await searchParams;

  if (sessionId) {
    const session = await auth();
    if (!session?.user?.id) redirect("/sign-in");
    return (
      <div className="h-screen w-full">
        <WorkoutScreen
          sessionType={sessionId}
          userId={session.user.id}
          aiDeload={aiDeload === "1"}
          wasOverride={wasOverride === "1"}
        />
      </div>
    );
  }

  return <TabPage initialTab="workout" />;
}
