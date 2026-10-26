import assert from "node:assert/strict"
import test from "node:test"
import { audioExtension, parseEdgeTtsVoices, parseElevenLabsVoices, parseEspeakVoices, parseSayVoices } from "../src/audio.ts"

test("parses Edge TTS voice metadata", () => {
  const voices = parseEdgeTtsVoices(JSON.stringify([
    { ShortName: "en-US-AvaNeural", FriendlyName: "Ava", Locale: "en-US", Gender: "Female" },
  ]))
  assert.deepEqual(voices, [{ id: "en-US-AvaNeural", name: "Ava", locale: "en-US", detail: "Female" }])
})

test("parses the current Edge TTS table output", () => {
  const output = [
    "Name              Gender  ContentCategories  VoicePersonalities",
    "----------------  ------  -----------------  ------------------",
    "en-US-AvaNeural   Female  General            Friendly, Positive",
    "en-GB-RyanNeural  Male    General, News      Confident",
  ].join("\n")
  assert.deepEqual(parseEdgeTtsVoices(output), [
    { id: "en-US-AvaNeural", name: "en-US-AvaNeural", detail: "Female", locale: "en-US" },
    { id: "en-GB-RyanNeural", name: "en-GB-RyanNeural", detail: "Male", locale: "en-GB" },
  ])
})

test("parses Edge TTS key-value voice output", () => {
  const output = [
    "Name: Microsoft Voice (en-US, AvaNeural)",
    "ShortName: en-US-AvaNeural",
    "Gender: Female",
    "Locale: en-US",
    "",
    "Name: Microsoft Voice (en-GB, RyanNeural)",
    "ShortName: en-GB-RyanNeural",
    "Gender: Male",
    "Locale: en-GB",
  ].join("\n")
  assert.deepEqual(parseEdgeTtsVoices(output), [
    { id: "en-US-AvaNeural", name: "Microsoft Voice (en-US, AvaNeural)", locale: "en-US", detail: "Female" },
    { id: "en-GB-RyanNeural", name: "Microsoft Voice (en-GB, RyanNeural)", locale: "en-GB", detail: "Male" },
  ])
})

test("parses macOS say voice names and locales", () => {
  assert.deepEqual(parseSayVoices("Ava                 en_US    # Sample voice\n"), [
    { id: "Ava", name: "Ava", locale: "en_US", detail: "Sample voice" },
  ])
})

test("parses espeak voice names and language codes", () => {
  assert.deepEqual(parseEspeakVoices(" 5  en-us           M  English (America)     en-us  \n"), [
    { id: "en-us", name: "English (America)", locale: "en-us", detail: "M" },
  ])
})

test("parses ElevenLabs voice metadata", () => {
  assert.deepEqual(parseElevenLabsVoices({ voices: [
    { voice_id: "voice-123", name: "Morgan", category: "premade", labels: { accent: "american", gender: "female" } },
  ] }), [
    { id: "voice-123", name: "Morgan", detail: "premade · american · female", backend: "elevenlabs" },
  ])
})

test("uses MP3 audio for ElevenLabs and a distinct cache entry for each voice engine", async () => {
  assert.equal(audioExtension({ backend: "elevenlabs" }), ".mp3")
  const { cachedAudioPath } = await import("../src/speech-cache.ts")
  assert.notEqual(
    cachedAudioPath("/cache", "message-1", "full", ".mp3", "elevenlabs:voice-123"),
    cachedAudioPath("/cache", "message-1", "full", ".mp3", "edge_tts:voice-123"),
  )
})
