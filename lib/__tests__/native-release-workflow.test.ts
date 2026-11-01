import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { NATIVE_CALLBACKS } from '@/lib/auth/mobile/native-transaction'
import { MOBILE_CALLBACKS } from '../../mobile/src/features/account/session'

// .github/workflows/native-release.yml builds the REAL app's APK (#2840). lib/github-release.ts
// offers the first `.apk` on the `apk-latest` release to the installed app as an update, so a
// workflow that put its APK on any release could hand the owner the native app as an "update".
// It is a workflow artifact only; the install is the owner's switch-over step.
const workflow = readFileSync(new URL('../../.github/workflows/native-release.yml', import.meta.url), 'utf8')
const code = workflow.replace(/^\s*#.*$/gm, '')

describe('native-release.yml', () => {
  it('runs only when dispatched by hand', () => {
    const triggers = code.match(/^on:\n((?: {2}.*\n|\n)+)/m)?.[1] ?? ''
    expect(triggers.match(/^ {2}\S+?:/gm)).toEqual(['  workflow_dispatch:'])
  })

  it('never publishes to apk-latest or any release', () => {
    expect(code).not.toMatch(/apk-latest/)
    expect(code).not.toMatch(/\bgh\s+release\b/)
    expect(code).not.toMatch(/gh api[^\n]*releases/)
    expect(code).not.toMatch(/softprops|action-gh-release|create-release|upload-release-asset/)
    expect(code).not.toMatch(/\bcontents:\s*write\b/)
    expect(code).not.toMatch(/\bgit\s+push\b/)
  })

  it('keeps its APK as a workflow artifact', () => {
    expect(code).toMatch(/uses:\s*actions\/upload-artifact@/)
    expect(code).toMatch(/^permissions:\n\s+contents:\s*read\s*$/m)
  })

  it('builds the real app ID, signed with the installed app\'s key and certificate', () => {
    expect(code).toMatch(/PACKAGE:\s*com\.trainingai\.app\s*$/m)
    expect(code).toMatch(/EAS_BUILD_PROFILE:\s*android-preview/)
    expect(code).not.toMatch(/APP_VARIANT/)
    expect(code).toMatch(/secrets\.ANDROID_DEBUG_KEYSTORE_B64/)
    const android = readFileSync(new URL('../../.github/workflows/android.yml', import.meta.url), 'utf8')
    const installed = android.match(/EXPECTED_CERT_SHA256:\s*([0-9a-f]{64})/)?.[1]
    expect(installed).toBeTruthy()
    expect(code).toContain(`EXPECTED_CERT_SHA256: ${installed}`)
  })

  it('does not interpolate inputs into a script', () => {
    const scripts = [...code.matchAll(/run:\s*\|\n((?: {10,}.*\n|\n)+)/g)].map(m => m[1]).join('\n')
    expect(scripts).not.toMatch(/\$\{\{/)
  })
})

describe('the real app\'s sign-in callback', () => {
  it('is the same on the server and in the app', () => {
    expect(MOBILE_CALLBACKS.android).toBe('com.trainingai.app:/auth/callback')
    expect(NATIVE_CALLBACKS.android).toBe(MOBILE_CALLBACKS.android)
  })
})
