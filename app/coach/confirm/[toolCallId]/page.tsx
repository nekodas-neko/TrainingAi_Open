import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { ConfirmContent } from "./confirm-content";

export const metadata = { title: "Review change" };

export default async function CoachConfirmPage({
  params,
}: {
  params: Promise<{ toolCallId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  const { toolCallId } = await params;
  return <ConfirmContent toolCallId={toolCallId} />;
}
