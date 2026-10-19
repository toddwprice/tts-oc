import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { claimSpeech } from "../src/speech-claim.ts"

test("one caller can claim a message until speech completes", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-tts-claim-test-"))

  try {
    const firstClaim = claimSpeech("message-1", directory)

    assert.ok(firstClaim)
    assert.equal(claimSpeech("message-1", directory), undefined)

    firstClaim.complete()

    assert.equal(claimSpeech("message-1", directory), undefined)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("a failed speech attempt releases its claim for retry", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-tts-claim-test-"))

  try {
    const firstClaim = claimSpeech("message-2", directory)

    assert.ok(firstClaim)
    firstClaim.release()

    assert.ok(claimSpeech("message-2", directory))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
