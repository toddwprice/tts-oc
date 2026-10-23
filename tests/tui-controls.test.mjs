import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

const source = readFileSync(new URL("../src/tui.tsx", import.meta.url), "utf8")

test("TUI build uses the host Solid runtime without deep import overrides", () => {
  const build = readFileSync(new URL("../build.mjs", import.meta.url), "utf8")
  assert.equal(build.includes('return "solid-js/dist/solid.js"'), false)
  assert.equal(build.includes('return "solid-js/store/dist/store.js"'), false)
})

test("speech controls expose both slash commands", () => {
  assert.match(source, /slash: \{ name: "tts-speak-response" \}/)
  assert.match(source, /slash: \{ name: "tts-speak-summary" \}/)
})

test("speech controls remain visible and provide hover and processing feedback", () => {
  assert.doesNotMatch(source, /visible=\{!busy\(\)\}/)
  assert.match(source, /onMouseOver=/)
  assert.match(source, /onMouseOut=/)
  assert.match(source, /Processing…/)
  assert.match(source, /#87CEFA/)
})

test("speech buttons hide while the active session is running", () => {
  assert.match(source, /context\.data\.session\.status\(props\.sessionID\) === "running"/)
  assert.match(source, /context\.data\.on\("session\.execution\.started"/)
  assert.match(source, /context\.data\.on\("session\.execution\.succeeded"/)
  assert.match(source, /context\.data\.on\("session\.execution\.failed"/)
  assert.match(source, /context\.data\.on\("session\.execution\.interrupted"/)
  assert.match(source, /<Show when=\{!agentWorking\(\) && props\.config\.buttonsVisible !== false\}>/)
})

test("hovering a Stop button uses a pale-red color", () => {
  assert.match(source, /playing\(\) && activeMode\(\) === mode/)
  assert.match(source, /hovered\(\) === mode \? "#FFCACA" : "#D96C6C"/)
})

test("buttonsVisible defaults to visible and does not hide keyboard commands", () => {
  assert.match(source, /props\.config\.buttonsVisible !== false/)
  assert.match(source, /palette: true/)
  assert.match(source, /slash: \{ name: "tts-speak-response" \}/)
  assert.match(source, /slash: \{ name: "tts-speak-summary" \}/)
})

test("voice browser is available as a palette and slash command", () => {
  assert.match(source, /title: "Browse Speech Voices"/)
  assert.match(source, /slash: \{ name: "tts-voices" \}/)
  assert.match(source, /listVoices\(props\.config\)/)
  assert.match(source, /bind: "ctrl\+o"/)
  assert.match(source, /previewVoice\(voice, props\.config\)/)
  assert.match(source, /saveVoiceSelection\(selectedVoice\)/)
})

test("cache clear command requires confirmation and runs through the speech queue", () => {
  assert.match(source, /title: "Clear Cached Audio"/)
  assert.match(source, /slash: \{ name: "tts-clear-cache" \}/)
  assert.match(source, /context\.ui\.dialog\.confirm/)
  assert.match(source, /runWithSpeechQueue\(SPEECH_QUEUE_DIR, async \(\) => clearAudioCache\(AUDIO_CACHE_DIR\)\)/)
})
