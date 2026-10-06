'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Boxes } from 'lucide-react'
import type { ModelBucketReport } from '@/lib/oura-models/bucket-report'

interface Report {
  requiredCount: number
  bucket: ModelBucketReport
  disk: { ok: boolean; missing: string[]; empty: string[] }
  servingFrom: string
}

const VERDICT_COLOR: Record<ModelBucketReport['verdict'], string> = {
  complete: 'var(--accent-green)',
  incomplete: 'var(--accent-amber)',
  unreachable: 'var(--accent-amber)',
}

// The Q-49 A1 gate, kept after A4b deleted the repo-tree copies: object storage is now the only
// source of the models, so this is where to ask whether it holds all of them.
export default function ModelAssetsCard() {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setRunning(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/model-assets')
      if (!res.ok) { setError(`HTTP ${res.status}`); return }
      setReport(await res.json() as Report)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Boxes className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Model asset delivery</span>
      </div>
      <p className="text-xs text-muted-foreground">
        Checks object storage for every ONNX model the server loads. Storage is the only copy since
        the repo-tree files were deleted, so anything short of &ldquo;complete&rdquo; means those
        models cannot run.
      </p>
      <Button size="sm" variant="outline" disabled={running} onClick={() => void run()}>
        {running ? 'Checking…' : 'Check model assets'}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {report && (
        <div className="space-y-1 text-xs">
          <p className="font-medium" style={{ color: VERDICT_COLOR[report.bucket.verdict] }}>
            Object storage: {report.bucket.verdict}
          </p>
          <p className="text-muted-foreground">{report.bucket.summary}</p>
          <p className="text-muted-foreground">
            Repo tree: {report.disk.ok
              ? `all ${report.requiredCount} present`
              : `${report.disk.missing.length + report.disk.empty.length} unusable`} · serving from {report.servingFrom}
          </p>
          {report.bucket.files.length > 0 && (
            <ul className="space-y-0.5 pt-1 font-mono text-[11px] text-muted-foreground">
              {report.bucket.files.map(f => (
                <li key={f.file}>
                  {f.found ? `${((f.sizeBytes ?? 0) / 1024).toFixed(0)} kB` : 'absent'} — {f.file}
                </li>
              ))}
            </ul>
          )}
          {report.bucket.unexpected.length > 0 && (
            <p className="text-muted-foreground">
              Not required by any loader: {report.bucket.unexpected.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
