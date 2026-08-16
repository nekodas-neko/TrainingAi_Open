import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { fetchLatestApkRelease } from '@/lib/github-release'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const release = await fetchLatestApkRelease()
  if (!release) {
    return NextResponse.json({ error: 'Could not fetch release info' }, { status: 502 })
  }
  if (!release.apkUrl) {
    return NextResponse.json({ error: 'No APK found in latest release' }, { status: 404 })
  }

  return NextResponse.redirect(release.apkUrl)
}
