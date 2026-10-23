import assert from "node:assert/strict"
import { mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { cacheRetentionMs, cachedAudioPath, cleanupAudioCache } from "../src/speech-cache.ts"

test("cache path uses a stable key for response, mode, and extension", () => {
  const first = cachedAudioPath("/cache", "message/id", "summary", ".mp3")
  const second = cachedAudioPath("/cache", "message/id", "summary", ".mp3")

  assert.equal(first, second)
  assert.match(first, /^\/cache\/summary-[a-f0-9]{64}\.mp3$/)
  assert.notEqual(first, cachedAudioPath("/cache", "message/id", "full", ".mp3"))
})

test("cache cleanup removes old files and keeps recent files", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-cache-test-"))
  const oldFile = path.join(directory, "old.mp3")
  const recentFile = path.join(directory, "recent.mp3")
  const pendingFile = path.join(directory, "recent.pending.mp3")
  const nestedFile = path.join(directory, "nested")
  mkdirSync(nestedFile)
  writeFileSync(oldFile, "old")
  writeFileSync(recentFile, "recent")
  writeFileSync(pendingFile, "pending")
  writeFileSync(path.join(nestedFile, "keep.mp3"), "keep")
  const now = Date.now()
  const oldDate = new Date(now - 4 * 24 * 60 * 60 * 1000)
  utimesSync(oldFile, oldDate, oldDate)

  try {
    assert.equal(cleanupAudioCache(directory, 3, now), 1)
    assert.deepEqual(readdirSync(directory).sort(), ["nested", "recent.mp3", "recent.pending.mp3"])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("cache cleanup uses three days when retention is invalid", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-cache-test-"))
  const file = path.join(directory, "old.mp3")
  writeFileSync(file, "old")
  const now = Date.now()
  const oldDate = new Date(now - 4 * 24 * 60 * 60 * 1000)
  utimesSync(file, oldDate, oldDate)

  try {
    assert.equal(cleanupAudioCache(directory, Number.NaN, now), 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("cache retention uses three days by default and accepts custom day counts", () => {
  assert.equal(cacheRetentionMs(undefined), 3 * 24 * 60 * 60 * 1000)
  assert.equal(cacheRetentionMs(7), 7 * 24 * 60 * 60 * 1000)
  assert.equal(cacheRetentionMs(-1), 3 * 24 * 60 * 60 * 1000)
  assert.equal(cacheRetentionMs(0), 3 * 24 * 60 * 60 * 1000)
})
