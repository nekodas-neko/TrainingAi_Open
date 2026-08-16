import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { isAdminUser } from "@/lib/admin";
import { SettingsContent } from "./settings-content";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/sign-in");
  // Render gate only — /more/settings/developer and every action under it re-check authoritatively.
  const isAdmin = await isAdminUser(session.user.id, session.user.isAdmin);
  return <SettingsContent isAdmin={isAdmin} />;
}
