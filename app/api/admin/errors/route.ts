import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepository } from "@/lib/data"
import { requireAdmin, adminErrorResponse } from "@/lib/admin"
import { requireOwnerSession } from "@/lib/admin/claude-token-auth"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  // Q-548, and this route is the sharpest case of it. The old shape was a bare `catch` around BOTH
  // the admin check and the read, so a database outage answered `403 Forbidden` — on the viewer you
  // reach for *during* an outage, pointing the investigation at credentials. `adminErrorResponse`
  // separates a genuine refusal (403) from a check that could not run (503), and the read now sits
  // outside the try so a failed query surfaces as the fault it is rather than as a permissions
  // problem.
  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }
  // #3951: error events are every account's, so only the owner reads them. Any other admin gets the
  // same refusal as db-query and db-snapshot (#3657); an owner that cannot be resolved refuses all.
  const owner = await requireOwnerSession(session.user.id)
  if (!owner.ok) return NextResponse.json({ error: owner.error }, { status: owner.status })

  const repo = await getRepository()
  const events = await repo.listErrorEvents(100)
  return NextResponse.json(events)
}
