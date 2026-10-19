import { Plugin } from "@opencode/plugin"
import os from "node:os"
import path from "node:path"
import { execFile as execFileCallback } from "node:child_process"
import { promisify } from "node:util"
import { appendFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { claimSpeech } from "./speech-claim.js"
import { fallbackSummaryFromText, normalizeText, sanitizeForSpeech } from "./speech-text.js"
import { generateSummary, type SummaryModel } from "./summary-model.js"

type PluginContext = Plugin.Context
const execFile = promisify(execFileCallback)

type TTSPluginConfig = {
  enabled?: boolean
  mode?: "full" | "summary"
  debug?: boolean
  backend?: "edge_tts" | "say"
  voice?: string
  summaryLength?: string
  summaryProvider?: string
  summaryModel?: string
  edge_tts?: {
    command?: string[]
    voice?: string
    rate?: string
    volume?: string
  }
}

const inFlightSessions = new Set<string>()
const latestAssistantMessageBySession = new Map<string, { messageID: string; providerID?: string; modelID?: string }>()
const assistantTextByMessage = new Map<string, string>()

let ttsMode: "full" | "summary" = "summary"
let ttsEnabled = true
let configuredSummaryModel: Pick<TTSPluginConfig, "summaryProvider" | "summaryModel"> = {}
const DEFAULT_SUMMARY_LENGTH = "2 sentences"
const DEFAULT_EDGE_TTS_COMMAND = ["edge-tts"]
const OPENCODE_DIR = path.join(os.homedir(), ".config", "opencode")
const VENV_DIR = path.join(OPENCODE_DIR, "tts-venv")
const VENV_PYTHON = path.join(VENV_DIR, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python")
const VENV_EDGE_TTS_COMMAND = [VENV_PYTHON, "-m", "edge_tts"]
const DEFAULT_EDGE_TTS_VOICE = "en-US-AvaNeural"
const DEFAULT_EDGE_TTS_RATE = "+25%"
const DEFAULT_EDGE_TTS_VOLUME = "+0%"
const PLUGIN_CONFIG_PATHS = [
  path.join(OPENCODE_DIR, "plugins", "opencode-tts.jsonc"),
  path.join(OPENCODE_DIR, "plugin", "opencode-tts.jsonc"),
]
const LOG_PATH = path.join(OPENCODE_DIR, "logs", "opencode-tts.log")
const SPEECH_CLAIM_DIR = path.join(OPENCODE_DIR, "tts-spoken")
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

function logLine(message: string, extra?: unknown) {
  try {
    const config = getPluginConfig()
    if (!config.debug) return
    mkdirSync(path.dirname(LOG_PATH), { recursive: true })
    const suffix = extra === undefined ? "" : ` ${JSON.stringify(extra)}`
    appendFileSync(LOG_PATH, `${new Date().toISOString()} ${message}${suffix}\n`)
  } catch {
    // Ignore logging failures.
  }
}

function normalizePluginConfig(config?: TTSPluginConfig): TTSPluginConfig {
  return config ?? {}
}

function loadPluginConfigFromDisk(): TTSPluginConfig {
  for (const configPath of PLUGIN_CONFIG_PATHS) {
    try {
      const content = readFileSync(configPath, "utf8")
      return normalizePluginConfig(JSON.parse(stripJsonComments(content)) as TTSPluginConfig)
    } catch {
      // Try the next supported location.
    }
  }
  return {}
}

function setPluginConfig(config?: TTSPluginConfig) {
  currentPluginConfig = normalizePluginConfig(config)
}

function savePluginConfig(patch: Partial<TTSPluginConfig>) {
  const updated = { ...currentPluginConfig, ...patch }
  const configPath = PLUGIN_CONFIG_PATHS[0]
  const dir = path.dirname(configPath)
  mkdirSync(dir, { recursive: true })
  writeFileSync(configPath, JSON.stringify(updated, null, 2), "utf8")
  setPluginConfig(updated)
}

function getPluginConfig() {
  if (Object.keys(currentPluginConfig).length === 0) {
    currentPluginConfig = loadPluginConfigFromDisk()
  }
  return currentPluginConfig
}

async function findPython(): Promise<string | undefined> {
  for (const candidate of ["python3", "python"]) {
    try {
      await execFile(candidate, ["--version"])
      return candidate
    } catch {
      // Try the next Python executable.
    }
  }
  return undefined
}

async function ensureEdgeTts(): Promise<void> {
  // Already installed in our venv?
  try {
    await execFile(VENV_PYTHON, ["-c", "import edge_tts"])
    return
  } catch {
    // Install edge-tts when it is not in the managed environment.
  }

  logLine("edge_tts.install.start", { venvDir: VENV_DIR })

  const python = await findPython()
  if (!python) {
    logLine("edge_tts.install.no-python")
    return
  }

  // Create venv if it doesn't exist yet
  try {
    await execFile(python, ["-m", "venv", VENV_DIR])
  } catch (err) {
    logLine("edge_tts.install.venv-failed", serializeUnknown(err))
    return
  }

  // Install edge-tts into the venv
  try {
    await execFile(VENV_PYTHON, ["-m", "pip", "install", "--quiet", "edge-tts"])
  } catch (err) {
    logLine("edge_tts.install.pip-failed", serializeUnknown(err))
    return
  }

  logLine("edge_tts.install.success")
}

async function commandExists(command: string) {
  try {
    await execFile("which", [command])
    return true
  } catch {
    return false
  }
}

async function resolveEdgeTtsCommand(configured?: string[]) {
  if (configured?.length) return configured

  // Auto-install into our managed venv if needed
  await ensureEdgeTts()

  // Prefer our managed venv
  try {
    await execFile(VENV_PYTHON, ["-c", "import edge_tts"])
    return VENV_EDGE_TTS_COMMAND
  } catch {
    // Check system installations next.
  }

  // Fall back to whatever is on PATH
  if (await commandExists("edge-tts")) return DEFAULT_EDGE_TTS_COMMAND

  try {
    await execFile("python3", ["-c", "import edge_tts"])
    return ["python3", "-m", "edge_tts"]
  } catch {
    // Use the normal edge-tts command as the final fallback.
  }

  return DEFAULT_EDGE_TTS_COMMAND
}

function serializeUnknown(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }

  if (!value || typeof value !== "object") return value

  const record = value as Record<string, unknown>
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (key === "request") continue
    if (key === "response" && entry && typeof entry === "object") {
      const response = entry as Response
      output.response = {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        url: response.url,
      }
      continue
    }
    output[key] = entry
  }
  return output
}

async function summarizeText(
  ctx: PluginContext,
  inputText: string,
  sourceModel?: SummaryModel,
) {
  logLine("summarize.start", { inputLength: inputText.length, sourceModel })

  const summaryLength = getPluginConfig().summaryLength ?? DEFAULT_SUMMARY_LENGTH
  const summaryPrompt = [
    `Summarize the following assistant response as spoken audio copy in ${summaryLength}.`,
    "Keep concrete facts, decisions, and next actions.",
    "Do not mention that this is a summary.",
    "Paraphrase instead of copying the opening words when possible.",
    "Never output chain-of-thought, think tags, reflection tags, or XML-like tags.",
    "Do not use bullets, numbering, markdown, or preamble.",
    "",
    sanitizeForSpeech(inputText),
  ].join("\n")

  const pluginConfig = getPluginConfig()
  const summaryProvider = configuredSummaryModel.summaryProvider ?? pluginConfig.summaryProvider
  const summaryModel = configuredSummaryModel.summaryModel ?? pluginConfig.summaryModel
  const summary = await generateSummary(summaryProvider, summaryModel, sourceModel, async (summaryModel) => {
    logLine("summarize.model", { summaryModel })
    const response = await ctx.generate.text({
      model: { providerID: summaryModel.providerID, id: summaryModel.modelID },
      prompt: summaryPrompt,
    })
    const text = sanitizeForSpeech(response.text)
    logLine("summarize.response.text", { summary: text })
    return text
  }, (summaryModel, error) => {
    logLine("summarize.model.error", { summaryModel, error: serializeUnknown(error) })
  })
  logLine("summarize.success", { summary })
  return summary
}

async function runTts(text: string, voice?: string) {
  const normalized = sanitizeForSpeech(text)
  if (!normalized) return

  const config = getPluginConfig()

  const backend = config.backend ?? "edge_tts"

  if (backend === "edge_tts") {
    const command = await resolveEdgeTtsCommand(config.edge_tts?.command)
    const edgeVoice = voice ?? config.voice ?? config.edge_tts?.voice ?? DEFAULT_EDGE_TTS_VOICE
    const rate = config.edge_tts?.rate ?? DEFAULT_EDGE_TTS_RATE
    const volume = config.edge_tts?.volume ?? DEFAULT_EDGE_TTS_VOLUME
    const outputPath = path.join(
      os.tmpdir(),
      `opencode-tts-${Date.now()}-${Math.random().toString(36).slice(2)}.mp3`,
    )

    try {
      logLine("tts.edge_tts.start", { command, voice: edgeVoice, rate, volume, outputPath })
      await execFile(command[0], [...command.slice(1), "--voice", edgeVoice, "--rate", rate, "--volume", volume, "--text", normalized, "--write-media", outputPath])
      logLine("tts.edge_tts.generated", { outputPath })

      if (process.platform === "darwin") {
        await execFile("/usr/bin/afplay", [outputPath])
        logLine("tts.playback.afplay.success", { outputPath })
        return
      }

      if (await commandExists("ffplay")) {
        await execFile("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", outputPath])
        return
      }

      if (await commandExists("mpg123")) {
        await execFile("mpg123", ["-q", outputPath])
        return
      }

      throw new Error("No audio player found for edge_tts output. Install `afplay`, `ffplay`, or `mpg123`.")
    } finally {
      try {
        unlinkSync(outputPath)
      } catch {
        // Ignore cleanup failures for temp audio files.
      }
    }
  }

  const sayVoice = voice ?? config.voice
  if (process.platform === "darwin") {
    if (sayVoice) {
      await execFile("/usr/bin/say", ["-v", sayVoice, normalized])
      return
    }
    await execFile("/usr/bin/say", [normalized])
    return
  }

  if (await commandExists("spd-say")) {
    await execFile("spd-say", [normalized])
    return
  }

  if (await commandExists("espeak")) {
    await execFile("espeak", [normalized])
    return
  }

  throw new Error("No supported TTS command found. Install `say`, `spd-say`, or `espeak`.")
}

async function summarizeAndSpeak(
  ctx: PluginContext,
  text: string,
  sourceModel?: SummaryModel,
  voice?: string,
) {
  let summary: string
  try {
    summary = await summarizeText(ctx, text, sourceModel)
  } catch (error) {
    logLine("summarize.error", serializeUnknown(error))
    summary = fallbackSummaryFromText(text)
    logLine("summarize.fallback", {
      reason: error instanceof Error ? error.message : String(error),
      summary,
    })
  }
  await runTts(summary, voice)
  return summary
}

const TTS_COMMANDS = [
  { name: "tts-mode-summary", description: "Speak a summary of each response" },
  { name: "tts-mode-full", description: "Speak the full response text" },
  { name: "tts-on", description: "Enable automatic text-to-speech" },
  { name: "tts-off", description: "Disable automatic text-to-speech" },
  { name: "tts-speak", description: "Speak the text that follows the command" },
  { name: "tts-repeat", description: "Speak the last assistant response again" },
]

function assistantText(message: { type: string; content?: Array<{ type: string; text?: string }> }) {
  if (message.type !== "assistant" || !message.content) return ""
  return sanitizeForSpeech(message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" "))
}

async function speakLatest(ctx: PluginContext, sessionID: string) {
  const messages = await ctx.session.context({ sessionID })
  const message = [...messages].reverse().find((item) => item.type === "assistant")
  if (!message || message.type !== "assistant") return false

  const text = assistantText(message)
  if (!text) return false
  const sourceModel = { providerID: message.model.providerID, modelID: message.model.id }
  if (ttsMode === "full") await runTts(text)
  else await summarizeAndSpeak(ctx, text, sourceModel)
  return true
}

async function reportCommandResult(
  ctx: PluginContext,
  sessionID: string,
  delivery: Parameters<PluginContext["session"]["prompt"]>[0]["delivery"],
  result: string,
) {
  await ctx.session.prompt({
    sessionID,
    text: `Reply with exactly this command result and no extra text: ${JSON.stringify(result)}`,
    delivery,
  })
}

export default Plugin.define({
  id: "opencode-tts",
  async setup(ctx) {
    setPluginConfig(loadPluginConfigFromDisk())
    const options = ctx.options as Pick<TTSPluginConfig, "summaryProvider" | "summaryModel">
    configuredSummaryModel = {
      summaryProvider: options.summaryProvider,
      summaryModel: options.summaryModel,
    }
    const initialConfig = getPluginConfig()
    ttsMode = initialConfig.mode ?? "summary"
    ttsEnabled = initialConfig.enabled !== false
    logLine("plugin.setup", { enabled: ttsEnabled, mode: ttsMode, directory: ctx.location.directory })

    const controller = new AbortController()
    void (async () => {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        if (event.type === "session.execution.succeeded") {
          logLine("event.session.execution.succeeded.received", {
            sessionID: event.data.sessionID,
            eventDirectory: event.location?.directory,
            pluginDirectory: ctx.location.directory,
          })
        }
        if (event.type !== "session.execution.succeeded") continue
        const sessionID = event.data.sessionID
        const session = await ctx.session.get({ sessionID })
        const sessionDirectory = event.location?.directory ?? session.location.directory
        if (sessionDirectory !== ctx.location.directory) continue
        if (inFlightSessions.has(sessionID)) continue
        inFlightSessions.add(sessionID)
        let speechClaim: ReturnType<typeof claimSpeech>
        try {
          if (!ttsEnabled) {
            logLine("event.session.execution.succeeded.disabled", { sessionID })
            continue
          }
          const messages = await ctx.session.context({ sessionID })
          const message = [...messages].reverse().find((item) => item.type === "assistant")
          if (!message || message.type !== "assistant") {
            logLine("event.session.execution.succeeded.no-assistant-message", { sessionID, messageCount: messages.length })
            continue
          }
          speechClaim = claimSpeech(message.id, SPEECH_CLAIM_DIR)
          if (!speechClaim) {
            logLine("event.session.execution.succeeded.already-claimed", { sessionID, messageID: message.id })
            continue
          }
          const text = assistantText(message)
          if (!text) {
            speechClaim.release()
            logLine("event.session.execution.succeeded.no-text", { sessionID, messageID: message.id })
            continue
          }
          const summary = ttsMode === "full"
            ? (await runTts(text), text)
            : await summarizeAndSpeak(ctx, text, { providerID: message.model.providerID, modelID: message.model.id })
          speechClaim.complete()
          if (getPluginConfig().debug) console.log(`[opencode-tts] ${summary}`)
          logLine("event.session.execution.succeeded.spoken", { sessionID, messageID: message.id, summary })
        } catch (error) {
          speechClaim?.release()
          logLine("event.session.execution.succeeded.error", {
            sessionID,
            error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
          })
        } finally {
          inFlightSessions.delete(sessionID)
        }
      }
    })().catch((error) => logLine("event.subscription.error", serializeUnknown(error)))

    await ctx.command.transform((editor) => {
      for (const command of TTS_COMMANDS) {
        editor.add({
          ...command,
          execute: async ({ sessionID, prompt, delivery }) => {
            let result: string
            try {
              if (command.name === "tts-mode-summary") {
                savePluginConfig({ mode: "summary" })
                ttsMode = "summary"
                result = "Text-to-speech summary mode is on."
              } else if (command.name === "tts-mode-full") {
                savePluginConfig({ mode: "full" })
                ttsMode = "full"
                result = "Text-to-speech full-response mode is on."
              } else if (command.name === "tts-on") {
                savePluginConfig({ enabled: true })
                ttsEnabled = true
                result = "Text-to-speech is on."
              } else if (command.name === "tts-off") {
                savePluginConfig({ enabled: false })
                ttsEnabled = false
                result = "Text-to-speech is off."
              } else if (command.name === "tts-speak") {
                await runTts(prompt.text)
                result = "Text-to-speech finished successfully."
              } else if (command.name === "tts-repeat") {
                result = await speakLatest(ctx, sessionID)
                  ? "The last assistant response was spoken again."
                  : "No assistant response is available to repeat."
              } else {
                return
              }
            } catch (error) {
              result = `Text-to-speech command failed: ${error instanceof Error ? error.message : String(error)}`
              logLine("command.failed", { command: command.name, error: serializeUnknown(error) })
            }

            await reportCommandResult(ctx, sessionID, delivery, result)
          },
        })
      }
    })

    return () => controller.abort()
  },
})
