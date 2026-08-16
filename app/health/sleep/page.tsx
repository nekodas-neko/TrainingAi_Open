import { auth } from "@/auth";
import { SleepContent } from "./sleep-content";

export default async function SleepDetailPage() {
  const session = await auth();
  return <SleepContent userId={session?.user?.id} />;
}
