import { NextResponse } from 'next/server'

export function appleResponse(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}
