import { auth } from "@/auth";
import { ReadinessContent } from "./readiness-content";

export default async function ReadinessDetailPage() {
  const session = await auth();
  return <ReadinessContent userId={session?.user?.id} />;
}
