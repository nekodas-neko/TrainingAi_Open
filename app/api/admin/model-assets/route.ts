import { NextResponse } from 'next/server'
import path from 'node:path'
import { auth } from '@/auth'
import { requireAdmin, adminErrorResponse } from '@/lib/admin'
import { reportModelBucketAssets, reportConstantsBucketAssets } from '@/lib/oura-models/bucket-report'
import { verifyModelAssets, REQUIRED_MODEL_FILES } from '@/lib/oura-models/required-models'
import modelFiles from '@/lib/oura-models/model-files.json'

/**
 * Where the eight ONNX models and the 34 constants files are actually coming from — the Q-49 A1/A3
 * gate, made checkable.
 *
 * Read-only, GET-only, admin-only. Returns both sides so the decision is one glance: what object
 * storage holds, and what is still in the repo tree. Both verdicts reading `complete` is the
 * evidence needed to delete the local copies and make the boot checks fatal.
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await requireAdmin(session.user.id, session.user.isAdmin)
  } catch (err) {
    return adminErrorResponse(err)
  }

  const [bucket, disk, constantsBucket] = await Promise.all([
    reportModelBucketAssets(),
    verifyModelAssets(path.join(process.cwd(), 'lib', 'oura-models', 'onnx')),
    reportConstantsBucketAssets(),
  ])

  return NextResponse.json({
    requiredCount: REQUIRED_MODEL_FILES.length,
    bucket,
    disk,
    // `getSession` reads the bucket first, so this is what production is actually serving from.
    servingFrom: bucket.verdict === 'complete' ? 'object storage' : 'the repo tree (fallback)',
    constants: {
      requiredCount: modelFiles.constantsRequired.length,
      bucket: constantsBucket,
      // Unlike the models, the constants have no per-request fallback: the loader is synchronous and
      // reads whichever directory `deliverConstants()` settled on at boot. So this reports where the
      // running process is reading from, which is decided once and cannot change under it.
      servingFrom: process.env.OURA_CONSTANTS_DIR ?? 'not delivered — the loader will throw',
    },
  })
}
