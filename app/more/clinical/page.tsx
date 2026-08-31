import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ClinicalContent } from "./clinical-content";

export default async function ClinicalPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return <ClinicalContent />;
}
