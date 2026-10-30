import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { audioExtension, createAudioFile, listVoices } from "../src/audio.ts"
import { createKokoroAudioFile, KOKORO_VOICE_OPTIONS } from "../src/kokoro.ts"

test("Kokoro voice catalog has 28 English options without loading the model", async () => {
  assert.equal(KOKORO_VOICE_OPTIONS.length, 28)
  assert.ok(KOKORO_VOICE_OPTIONS.some((voice) => voice.id === "af_heart"))
  assert.ok(KOKORO_VOICE_OPTIONS.some((voice) => voice.id === "bm_george"))
  assert.ok(KOKORO_VOICE_OPTIONS.every((voice) => voice.backend === "kokoro"))

  const originalKey = process.env.ELEVENLABS_API_KEY
  delete process.env.ELEVENLABS_API_KEY
  try {
    const voices = await listVoices({ backend: "kokoro" }, async () => {
      assert.fail("Kokoro voice discovery must not load the model")
    })
    assert.deepEqual(voices, KOKORO_VOICE_OPTIONS)
  } finally {
    if (originalKey !== undefined) process.env.ELEVENLABS_API_KEY = originalKey
  }
})

test("Kokoro voices are available in the voice picker with other backends", async () => {
  const originalKey = process.env.ELEVENLABS_API_KEY
  delete process.env.ELEVENLABS_API_KEY
  try {
    const voices = await listVoices({ backend: "edge_tts" }, async () => [
      { id: "en-US-AvaNeural", name: "Ava", backend: "edge_tts" },
    ])
    assert.ok(voices.some((voice) => voice.id === "en-US-AvaNeural"))
    assert.ok(voices.some((voice) => voice.id === "af_heart" && voice.backend === "kokoro"))
  } finally {
    if (originalKey !== undefined) process.env.ELEVENLABS_API_KEY = originalKey
  }
})

test("Kokoro writes WAV audio with the selected voice", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-kokoro-test-"))
  const output = path.join(directory, "speech.wav")
  const calls = []
  const model = {
    voices: { af_bella: {} },
    async generate(text, options) {
      calls.push({ text, options })
      return { toWav: () => new Uint8Array([82, 73, 70, 70]).buffer }
    },
  }
  try {
    await createKokoroAudioFile("Hello from Kokoro.", output, "af_bella", async () => model)
    assert.deepEqual(calls, [{ text: "Hello from Kokoro.", options: { voice: "af_bella" } }])
    assert.deepEqual(readFileSync(output), Buffer.from([82, 73, 70, 70]))
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("Kokoro is routed through audio creation and uses WAV files", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-kokoro-test-"))
  const output = path.join(directory, "speech.wav")
  const calls = []
  try {
    assert.equal(audioExtension({ backend: "kokoro" }), ".wav")
    await createAudioFile("Hello from Kokoro.", output, { backend: "kokoro", voice: "af_heart" }, undefined,
      async (text, path, voice) => {
        calls.push({ text, voice })
        writeFileSync(path, "wav data")
      })
    assert.deepEqual(calls, [{ text: "Hello from Kokoro.", voice: "af_heart" }])
    assert.equal(readFileSync(output, "utf8"), "wav data")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
