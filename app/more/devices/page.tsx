import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DevicesContent } from "./devices-content";

export default async function DevicesPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return <DevicesContent />;
}
