import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { AboutContent } from "./about-content";

export default async function AboutPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  return <AboutContent />;
}
