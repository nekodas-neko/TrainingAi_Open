import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { DataContent } from "./data-content";

export default async function DataPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return <DataContent userId={session.user.id} />;
}
