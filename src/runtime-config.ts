import os from "node:os"
import path from "node:path"
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmdirSync, writeFileSync } from "node:fs"

export type TTSPluginConfig = {
  debug?: boolean
  backend?: "edge_tts" | "say" | "elevenlabs" | "kokoro"
  localBackend?: "edge_tts" | "say"
  voice?: string
  summaryLength?: string
  summaryPrompt?: string
  summaryProvider?: string
  summaryModel?: string
  cacheRetentionDays?: number
  buttonsVisible?: boolean
  edge_tts?: {
    command?: string[]
    voice?: string
    rate?: string
    volume?: string
  }
}

const OPENCODE_DIR = path.join(process.env.HOME ?? os.homedir(), ".config", "opencode")
export const PLUGIN_DATA_DIR = path.join(OPENCODE_DIR, "plugins", "tts-oc")
export const VENV_DIR = path.join(PLUGIN_DATA_DIR, "venv")
export const AUDIO_CACHE_DIR = path.join(PLUGIN_DATA_DIR, "audio-cache")
export const SPEECH_QUEUE_DIR = path.join(PLUGIN_DATA_DIR, "queue")
export const PLUGIN_CONFIG_PATH = path.join(PLUGIN_DATA_DIR, "config.json")
export const LEGACY_PLUGIN_CONFIG_PATH = path.join(PLUGIN_DATA_DIR, "config.jsonc")
export const LOG_PATH = path.join(PLUGIN_DATA_DIR, "tts-oc.log")
const LEGACY_CONFIG_PATHS = [
  path.join(OPENCODE_DIR, "plugins", "tts-oc.jsonc"),
  path.join(OPENCODE_DIR, "plugin", "tts-oc.jsonc"),
  path.join(OPENCODE_DIR, "plugins", "opencode-tts.jsonc"),
  path.join(OPENCODE_DIR, "plugin", "opencode-tts.jsonc"),
]

const PLUGIN_CONFIG_PATHS = [
  PLUGIN_CONFIG_PATH,
  LEGACY_PLUGIN_CONFIG_PATH,
  ...LEGACY_CONFIG_PATHS,
]

let currentPluginConfig: TTSPluginConfig = {}

function stripJsonComments(value: string) {
  let result = ""
  let inString = false
  let escaped = false

  for (let index = 0; index < value.length; index++) {
    const current = value[index]
    const next = value[index + 1]

    if (inString) {
      result += current
      if (escaped) escaped = false
      else if (current === "\\") escaped = true
      else if (current === '"') inString = false
      continue
    }

    if (current === '"') {
      inString = true
      result += current
    } else if (current === "/" && next === "/") {
      while (index < value.length && value[index] !== "\n") index++
      result += "\n"
    } else if (current === "/" && next === "*") {
      index += 2
      while (index < value.length && !(value[index] === "*" && value[index + 1] === "/")) {
        if (value[index] === "\n") result += "\n"
        index++
      }
      index++
    } else {
      result += current
    }
  }

  return result
}

export function logLine(message: string, extra?: unknown) {
  try {
    if (!getPluginConfig().debug) return
    mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}${suffix}\n`)
  } catch {
    // Ignore logging failures.
  }
}

export function loadPluginConfigFromDisk(): TTSPluginConfig {
  for (const configPath of PLUGIN_CONFIG_PATHS) {
    try {
      const content = readFileSync(configPath, "utf8")
      return JSON.parse(stripJsonComments(content)) as TTSPluginConfig
    } catch {
      // Try the next supported location.
    }
  }
  return {}
}

export function setPluginConfig(config?: TTSPluginConfig) {
  currentPluginConfig = config ?? {}
}

export function saveVoiceSelection(voice: string, backend?: TTSPluginConfig["backend"]) {
  const current = loadPluginConfigFromDisk()
  const selectedBackend = backend ?? current.backend
  const localBackend = selectedBackend === "elevenlabs"
    ? current.backend === "elevenlabs" ? current.localBackend ?? "edge_tts" : current.backend === "say" ? "say" : "edge_tts"
    : undefined
  const { localBackend: _previousLocalBackend, ...baseConfig } = current
  const config = {
    ...baseConfig,
    ...(backend ? { backend } : {}),
    ...(localBackend ? { localBackend } : {}),
    voice,
  }
  mkdirSync(path.dirname(PLUGIN_CONFIG_PATH), { recursive: true })
  writeFileSync(PLUGIN_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
  setPluginConfig(config)
  return config
}

export function toggleButtonsVisible(currentVisibility = loadPluginConfigFromDisk().buttonsVisible !== false) {
  const config = loadPluginConfigFromDisk()
  config.buttonsVisible = !currentVisibility
  mkdirSync(path.dirname(PLUGIN_CONFIG_PATH), { recursive: true })
  writeFileSync(PLUGIN_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
  setPluginConfig(config)
  return config
}

export function saveSummaryPrompt(summaryPrompt?: string) {
  const config = loadPluginConfigFromDisk()
  if (summaryPrompt) config.summaryPrompt = summaryPrompt
  else delete config.summaryPrompt
  mkdirSync(path.dirname(PLUGIN_CONFIG_PATH), { recursive: true })
  writeFileSync(PLUGIN_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`)
  setPluginConfig(config)
  return config
}

export function getPluginConfig() {
  return currentPluginConfig
}

export function configFromPluginOptions(options: Record<string, unknown>): TTSPluginConfig {
  const current = loadPluginConfigFromDisk()
  const pluginOptions = { ...options }
  const summaryProvider = typeof pluginOptions.summaryProvider === "string" ? pluginOptions.summaryProvider : current.summaryProvider
  const summaryModel = typeof pluginOptions.summaryModel === "string" ? pluginOptions.summaryModel : current.summaryModel
  delete pluginOptions.summaryProvider
  delete pluginOptions.summaryModel
  return {
    ...current,
    ...pluginOptions,
    ...(typeof current.buttonsVisible === "boolean" ? { buttonsVisible: current.buttonsVisible } : {}),
    summaryProvider,
    summaryModel,
    edge_tts: {
      ...current.edge_tts,
      ...(options.edge_tts && typeof options.edge_tts === "object" ? options.edge_tts as TTSPluginConfig["edge_tts"] : {}),
    },
  }
}

function moveLegacyPath(legacyPath: string, currentPath: string, preservedPath: string) {
  if (!existsSync(legacyPath)) return

  if (existsSync(currentPath) && lstatSync(legacyPath).isDirectory() && lstatSync(currentPath).isDirectory()) {
    for (const entry of readdirSync(legacyPath)) {
      moveLegacyPath(path.join(legacyPath, entry), path.join(currentPath, entry), path.join(preservedPath, entry))
    }
    try {
      rmdirSync(legacyPath)
    } catch {
      // Keep any entries that could not move.
    }
    return
  }

  const destination = existsSync(currentPath) ? preservedPath : currentPath
  if (existsSync(destination)) return
  mkdirSync(path.dirname(destination), { recursive: true })
  renameSync(legacyPath, destination)
}

function migrateLegacyConfig() {
  if (existsSync(PLUGIN_CONFIG_PATH)) return
  const legacyConfig = PLUGIN_CONFIG_PATHS.slice(1).find((configPath) => existsSync(configPath))
  if (!legacyConfig) return
  try {
    mkdirSync(path.dirname(PLUGIN_CONFIG_PATH), { recursive: true })
    if (legacyConfig === LEGACY_PLUGIN_CONFIG_PATH) {
      writeFileSync(PLUGIN_CONFIG_PATH, readFileSync(legacyConfig, "utf8"))
    } else {
      renameSync(legacyConfig, PLUGIN_CONFIG_PATH)
    }
  } catch {
    // The loader can still read the old file if it cannot be moved.
  }
}

export function migrateLegacyData() {
  const moves = [
    [path.join(OPENCODE_DIR, "tts-venv"), path.join(PLUGIN_DATA_DIR, "venv"), path.join(PLUGIN_DATA_DIR, "legacy", "tts-venv")],
    [path.join(OPENCODE_DIR, "tts-spoken"), path.join(PLUGIN_DATA_DIR, "spoken"), path.join(PLUGIN_DATA_DIR, "legacy", "tts-spoken")],
    [path.join(OPENCODE_DIR, "tts-queue"), SPEECH_QUEUE_DIR, path.join(PLUGIN_DATA_DIR, "legacy", "tts-queue")],
    [path.join(OPENCODE_DIR, "logs", "tts-oc.log"), LOG_PATH, path.join(PLUGIN_DATA_DIR, "legacy", "logs-tts-oc.log")],
    [path.join(OPENCODE_DIR, "logs", "opencode-tts.log"), LOG_PATH, path.join(PLUGIN_DATA_DIR, "legacy", "logs-opencode-tts.log")],
  ]

  for (const [legacyPath, currentPath, preservedPath] of moves) {
    try {
      moveLegacyPath(legacyPath, currentPath, preservedPath)
    } catch {
      // Keep using the new locations if a legacy item cannot move.
    }
  }
  migrateLegacyConfig()
}

export function initializeRuntimeConfig() {
  migrateLegacyData()
  setPluginConfig(loadPluginConfigFromDisk())
}
