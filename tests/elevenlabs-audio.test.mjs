import assert from "node:assert/strict"
import test from "node:test"
import { audioExtension, createAudioFile, listVoices, parseElevenLabsVoices } from "../src/audio.ts"

test("ElevenLabs voices have the engine ID and descriptive labels", () => {
  assert.deepEqual(parseElevenLabsVoices({ voices: [
    { voice_id: "voice-123", name: "Morgan", category: "premade", labels: { accent: "american", gender: "female" } },
  ] }), [
    { id: "voice-123", name: "Morgan", detail: "premade · american · female", backend: "elevenlabs" },
  ])
})

test("ElevenLabs uses MP3 files", () => {
  assert.equal(audioExtension({ backend: "elevenlabs" }), ".mp3")
})

test("ElevenLabs voice listing requests the authenticated voices endpoint", async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY
  const originalFetch = globalThis.fetch
  let request
  process.env.ELEVENLABS_API_KEY = "test-key"
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return Response.json({ voices: [{ voice_id: "voice-123", name: "Morgan" }] })
  }
  try {
    assert.deepEqual(await listVoices({ backend: "elevenlabs" }, async () => []), [
      { id: "voice-123", name: "Morgan", detail: undefined, backend: "elevenlabs" },
    ])
    assert.equal(request.url, "https://api.elevenlabs.io/v1/voices")
    assert.equal(request.options.headers["xi-api-key"], "test-key")
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = originalKey
  }
})

test("ElevenLabs voice listing also includes voices from the saved local engine", async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY
  const originalFetch = globalThis.fetch
  process.env.ELEVENLABS_API_KEY = "test-key"
  globalThis.fetch = async () => Response.json({ voices: [{ voice_id: "voice-123", name: "Morgan" }] })
  try {
    assert.deepEqual(await listVoices({ backend: "elevenlabs", localBackend: "say" }, async (backend) => {
      assert.equal(backend, "say")
      return [{ id: "Ava", name: "Ava", backend: "say" }]
    }), [
      { id: "Ava", name: "Ava", backend: "say" },
      { id: "voice-123", name: "Morgan", detail: undefined, backend: "elevenlabs" },
    ])
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = originalKey
  }
})

test("ElevenLabs voice listing fails with a clear error when no API key exists", async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY
  delete process.env.ELEVENLABS_API_KEY
  try {
    await assert.rejects(listVoices({ backend: "elevenlabs" }, async () => []), /Set ELEVENLABS_API_KEY/)
  } finally {
    if (originalKey !== undefined) process.env.ELEVENLABS_API_KEY = originalKey
  }
})

test("ElevenLabs speech writes the returned audio bytes", async () => {
  const { mkdtempSync, readFileSync, rmSync } = await import("node:fs")
  const os = await import("node:os")
  const path = await import("node:path")
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-elevenlabs-test-"))
  const output = path.join(directory, "speech.mp3")
  const originalKey = process.env.ELEVENLABS_API_KEY
  const originalFetch = globalThis.fetch
  let request
  process.env.ELEVENLABS_API_KEY = "test-key"
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options }
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } })
  }
  try {
    await createAudioFile("Hello world.", output, { backend: "elevenlabs", voice: "voice/123" })
    assert.equal(request.url, "https://api.elevenlabs.io/v1/text-to-speech/voice%2F123")
    assert.deepEqual(JSON.parse(request.options.body), { text: "Hello world.", model_id: "eleven_multilingual_v2" })
    assert.deepEqual(readFileSync(output), Buffer.from([1, 2, 3]))
  } finally {
    globalThis.fetch = originalFetch
    if (originalKey === undefined) delete process.env.ELEVENLABS_API_KEY
    else process.env.ELEVENLABS_API_KEY = originalKey
    rmSync(directory, { recursive: true, force: true })
  }
})
