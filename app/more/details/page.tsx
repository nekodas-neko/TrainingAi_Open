import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DetailsContent } from "./details-content";

export default async function ProfileDetailsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return <DetailsContent />;
}
