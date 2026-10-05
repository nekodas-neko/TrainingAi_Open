import { mkdtempSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, it } from "vitest"
import { BUILD_SHA_FILE, readBuildSha } from "@/lib/build-sha"

const SHA_ENV = "1111111111111111111111111111111111111111"
const SHA_FILE = "2222222222222222222222222222222222222222"

function dirWith(contents?: string) {
  const dir = mkdtempSync(join(tmpdir(), "build-sha-"))
  if (contents !== undefined) writeFileSync(join(dir, BUILD_SHA_FILE), contents)
  return dir
}

describe("readBuildSha", () => {
  it("prefers Railway's own stamp when a GitHub-sourced deploy sets it", () => {
    expect(readBuildSha({ RAILWAY_GIT_COMMIT_SHA: SHA_ENV }, dirWith(SHA_FILE))).toBe(SHA_ENV)
  })

  it("reads the file the release workflow writes when the env var is absent", () => {
    expect(readBuildSha({}, dirWith(`${SHA_FILE}\n`))).toBe(SHA_FILE)
  })

  it("is null when neither source exists — never a made-up value", () => {
    expect(readBuildSha({}, dirWith())).toBeNull()
  })

  it("rejects a file that is not a commit id, rather than reporting it as one", () => {
    expect(readBuildSha({}, dirWith("not a sha"))).toBeNull()
  })
})
