import { auth } from "@/auth";
import { ActivityContent } from "./activity-content";

export default async function ActivityDetailPage() {
  const session = await auth();
  return <ActivityContent userId={session?.user?.id} />;
}
