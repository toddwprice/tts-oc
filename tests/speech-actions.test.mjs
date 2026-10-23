import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { speakLatestResponse } from "../src/speech-actions.ts"
import { cachedAudioPath } from "../src/speech-cache.ts"

function makeClient() {
  const calls = { context: 0, summary: 0 }
  return {
    calls,
    client: {
      session: {
        async context() {
          calls.context++
          return [{
            id: "message-1",
            type: "assistant",
            model: { providerID: "provider", id: "model" },
            content: [{ type: "text", text: "The response is ready." }],
          }]
        },
      },
      generate: {
        async text() {
          calls.summary++
          return { text: "The summary is ready." }
        },
      },
    },
  }
}

test("first full-response action creates cached audio and the next action replays it", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-action-test-"))
  const { client, calls } = makeClient()
  const created = []
  const played = []
  const dependencies = {
    client,
    sessionID: "session-1",
    mode: "full",
    cacheDirectory: directory,
    queueDirectory: path.join(directory, "queue"),
    config: { backend: "edge_tts" },
    async createAudio(text, outputPath) {
      created.push(text)
      writeFileSync(outputPath, `audio:${text}`)
    },
    async playAudio(filePath) {
      played.push(readFileSync(filePath, "utf8"))
    },
  }

  try {
    assert.deepEqual(await speakLatestResponse(dependencies), { ok: true, message: "Response played." })
    assert.deepEqual(await speakLatestResponse(dependencies), { ok: true, message: "Response played." })
    assert.deepEqual(created, ["The response is ready."])
    assert.deepEqual(played, ["audio:The response is ready.", "audio:The response is ready."])
    assert.equal(calls.summary, 0)
    assert.equal(readdirSync(directory).filter((name) => name.endsWith(".mp3")).length, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("summary action generates summary audio once and replays the saved file", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-action-test-"))
  const { client, calls } = makeClient()
  const created = []
  const played = []
  const dependencies = {
    client,
    sessionID: "session-1",
    mode: "summary",
    cacheDirectory: directory,
    queueDirectory: path.join(directory, "queue"),
    config: { backend: "edge_tts" },
    async createAudio(text, outputPath) {
      created.push(text)
      writeFileSync(outputPath, `audio:${text}`)
    },
    async playAudio(filePath) {
      played.push(readFileSync(filePath, "utf8"))
    },
  }

  try {
    await speakLatestResponse(dependencies)
    await speakLatestResponse(dependencies)
    assert.deepEqual(created, ["The summary is ready."])
    assert.equal(calls.summary, 1)
    assert.deepEqual(played, ["audio:The summary is ready.", "audio:The summary is ready."])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("summary falls back to spoken response text when model generation fails", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-action-test-"))
  const { client } = makeClient()
  client.generate.text = async () => { throw new Error("Unavailable") }
  let createdText

  try {
    await speakLatestResponse({
      client,
      sessionID: "session-1",
      mode: "summary",
      cacheDirectory: directory,
      queueDirectory: path.join(directory, "queue"),
      config: { backend: "edge_tts" },
      async createAudio(text, outputPath) {
        createdText = text
        writeFileSync(outputPath, "audio")
      },
      async playAudio() {},
    })
    assert.equal(createdText, "The response is ready.")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("separate response messages use separate cache entries", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-action-test-"))
  const { client } = makeClient()
  const created = []
  const dependencies = {
    client,
    sessionID: "session-1",
    mode: "full",
    cacheDirectory: directory,
    queueDirectory: path.join(directory, "queue"),
    config: { backend: "edge_tts" },
    async createAudio(text, outputPath) {
      created.push(text)
      const { writeFileSync } = await import("node:fs")
      writeFileSync(outputPath, `audio:${text}`)
    },
    async playAudio() {},
  }

  try {
    await speakLatestResponse(dependencies)
    client.session.context = async () => [{
      id: "message-2",
      type: "assistant",
      model: { providerID: "provider", id: "model" },
      content: [{ type: "text", text: "The next response is ready." }],
    }]
    await speakLatestResponse(dependencies)
    assert.deepEqual(created, ["The response is ready.", "The next response is ready."])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("uses a cache entry created by another OpenCode process", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-action-test-"))
  const { client } = makeClient()
  const cachePath = cachedAudioPath(directory, "message-1", "full", ".mp3")
  writeFileSync(cachePath, "cached by another process")
  let created = 0
  let played

  try {
    await speakLatestResponse({
      client,
      sessionID: "session-1",
      mode: "full",
      cacheDirectory: directory,
      queueDirectory: path.join(directory, "queue"),
      config: { backend: "edge_tts" },
      async createAudio() { created++ },
      async playAudio(filePath) { played = readFileSync(filePath, "utf8") },
    })
    assert.equal(created, 0)
    assert.equal(played, "cached by another process")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("no assistant response returns a useful status and creates no audio", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-action-test-"))
  const { client } = makeClient()
  client.session.context = async () => []

  try {
    const result = await speakLatestResponse({
      client,
      sessionID: "session-1",
      mode: "full",
      cacheDirectory: directory,
      queueDirectory: path.join(directory, "queue"),
      config: { backend: "edge_tts" },
      async createAudio() { assert.fail("Must not create audio") },
      async playAudio() { assert.fail("Must not play audio") },
    })
    assert.deepEqual(result, { ok: false, message: "No assistant response is available to speak." })
    assert.equal(readdirSync(directory).length, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
