import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { build } from "esbuild"

async function loadConfigModule(home) {
  const result = await build({
    entryPoints: ["src/runtime-config.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    define: { "process.env.HOME": JSON.stringify(home) },
  })
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}#${Math.random()}`)
}

test("loads and migrates legacy settings to config.json", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode")
  const legacyPath = path.join(configDir, "plugins", "opencode-tts.jsonc")
  const legacyData = { debug: true, backend: "say", cacheRetentionDays: 5 }
  mkdirSync(path.dirname(legacyPath), { recursive: true })
  writeFileSync(legacyPath, JSON.stringify(legacyData))

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.deepEqual(runtime.getPluginConfig(), legacyData)
    assert.deepEqual(JSON.parse(readFileSync(path.join(configDir, "plugins", "tts-oc", "config.json"), "utf8")), legacyData)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("config loads retain unknown settings", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode", "plugins", "tts-oc")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ debug: true, cacheRetentionDays: 3 }))

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.deepEqual(runtime.getPluginConfig(), { debug: true, cacheRetentionDays: 3 })
    assert.deepEqual(JSON.parse(readFileSync(path.join(configDir, "config.json"), "utf8")), { debug: true, cacheRetentionDays: 3 })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("config loads retain the buttonsVisible setting when disabled", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode", "plugins", "tts-oc")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ buttonsVisible: false }))

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.equal(runtime.getPluginConfig().buttonsVisible, false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("voice selection saves to config and keeps other settings", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode", "plugins", "tts-oc")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ backend: "say", buttonsVisible: false }))

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.deepEqual(runtime.saveVoiceSelection("Ava"), { backend: "say", buttonsVisible: false, voice: "Ava" })
    assert.deepEqual(JSON.parse(readFileSync(path.join(configDir, "config.json"), "utf8")), {
      backend: "say", buttonsVisible: false, voice: "Ava",
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("voice selection saves the selected backend", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode", "plugins", "tts-oc")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ buttonsVisible: false }))

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.deepEqual(runtime.saveVoiceSelection("voice-123", "elevenlabs"), {
      buttonsVisible: false, backend: "elevenlabs", localBackend: "edge_tts", voice: "voice-123",
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("button visibility toggles and persists, with visible as the default", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode", "plugins", "tts-oc")
  mkdirSync(configDir, { recursive: true })

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.equal(runtime.toggleButtonsVisible().buttonsVisible, false)
    assert.deepEqual(JSON.parse(readFileSync(path.join(configDir, "config.json"), "utf8")), { buttonsVisible: false })
    assert.equal(runtime.toggleButtonsVisible().buttonsVisible, true)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("summary prompt saves and resets without changing other settings", async () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "tts-oc-config-test-"))
  const configDir = path.join(home, ".config", "opencode", "plugins", "tts-oc")
  mkdirSync(configDir, { recursive: true })
  writeFileSync(path.join(configDir, "config.json"), JSON.stringify({ backend: "say", buttonsVisible: false }))

  try {
    const runtime = await loadConfigModule(home)
    runtime.initializeRuntimeConfig()
    assert.deepEqual(runtime.saveSummaryPrompt("Say {{summaryLength}}: {{response}}"), {
      backend: "say", buttonsVisible: false, summaryPrompt: "Say {{summaryLength}}: {{response}}",
    })
    assert.deepEqual(runtime.saveSummaryPrompt(), { backend: "say", buttonsVisible: false })
    assert.deepEqual(JSON.parse(readFileSync(path.join(configDir, "config.json"), "utf8")), {
      backend: "say", buttonsVisible: false,
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})
