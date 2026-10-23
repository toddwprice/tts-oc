import assert from "node:assert/strict"
import test from "node:test"
import { audioGenerationErrorMessage } from "../src/audio.ts"

test("formats Edge TTS no-audio errors without exposing text or traceback", () => {
  const error = Object.assign(new Error("Command failed: --text private response content"), {
    stderr: "Traceback (most recent call last):\nedge_tts.exceptions.NoAudioReceived: No audio was received.",
  })

  const message = audioGenerationErrorMessage(error)
  assert.match(message, /Edge TTS returned no audio/)
  assert.doesNotMatch(message, /private response content|Traceback|Command failed/)
})

test("formats other audio generation errors with a short safe message", () => {
  assert.equal(
    audioGenerationErrorMessage(new Error("Command failed: private input")),
    "Audio generation failed. Check the speech engine and try again.",
  )
})
