import { NextResponse } from 'next/server'
import { getRepository } from '@/lib/data'

export class AdminError extends Error {
  constructor() {
    super('Forbidden')
    this.name = 'AdminError'
  }
}

export async function requireAdmin(userId: string, _isAdmin?: boolean): Promise<void> {
  if (!await isAdminUser(userId)) {
    throw new AdminError()
  }
}

export async function isAdminUser(userId: string, _isAdmin?: boolean): Promise<boolean> {
  if (!userId) {
    return false
  }
  const user = await (await getRepository()).getUserById(userId)
  return user?.isActive === true && user.isAdmin === true
}

const ADMIN_ERROR_MARKER = 'AdminError'

export function isAdminRefusal(err: unknown): boolean {
  return err instanceof AdminError ||
    (typeof err === 'object' && err !== null && (err as { name?: unknown }).name === ADMIN_ERROR_MARKER)
}

export function adminFailureStatus(err: unknown): 403 | 503 {
  return isAdminRefusal(err) ? 403 : 503
}

export function adminFailureOutcome(err: unknown): { ok: false; status: 403 | 503; error: string } {
  return isAdminRefusal(err)
    ? { ok: false, status: 403, error: 'Forbidden' }
    : { ok: false, status: 503, error: 'Service unavailable' }
}

export function adminErrorResponse(err: unknown): NextResponse {
  return isAdminRefusal(err)
    ? NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    : NextResponse.json({ error: 'Service unavailable' }, { status: 503 })
}
