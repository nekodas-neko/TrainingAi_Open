import { NextResponse } from "next/server"
import { auth } from "@/auth"
import { getRepository } from "@/lib/data"
import { requireAdmin, adminErrorResponse } from "@/lib/admin"

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

  const repo = await getRepository()
  const events = await repo.listErrorEvents(100)
  return NextResponse.json(events)
}
