import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { ProgramContent } from "./program-content";

export default async function ProgramPage({
  searchParams,
}: { searchParams: Promise<{ new?: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const { new: newParam } = await searchParams;
  // Read here rather than in the client from window.location.search (Q-256): as a real route param
  // it is visible in this signature, so a redirect that forgets to forward it breaks loudly at the
  // type level instead of silently doing nothing.
  return <ProgramContent userId={session.user.id} openNewProgram={newParam === "program"} />;
}
