import { randomUUID } from "node:crypto"
import { execFile as execFileCallback } from "node:child_process"
import { mkdirSync, renameSync, unlinkSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { logLine, type TTSPluginConfig, VENV_DIR } from "./runtime-config.ts"

const execFile = promisify(execFileCallback)
const DEFAULT_EDGE_TTS_COMMAND = ["edge-tts"]
const DEFAULT_EDGE_TTS_VOICE = "en-US-AvaNeural"
const DEFAULT_EDGE_TTS_RATE = "+25%"
const DEFAULT_EDGE_TTS_VOLUME = "+0%"

async function commandExists(command: string) {
  try {
    await execFile("which", [command])
    return true
  } catch {
    return false
  }
}

function pythonPaths() {
  return {
    python: path.join(VENV_DIR, process.platform === "win32" ? "Scripts" : "bin", process.platform === "win32" ? "python.exe" : "python"),
  }
}

async function ensureEdgeTts(pythonPath: string): Promise<void> {
  try {
    await execFile(pythonPath, ["-c", "import edge_tts"])
    return
  } catch {
    // Install Edge TTS when it is not present in the managed environment.
  }

  let python: string | undefined
  for (const candidate of ["python3", "python"]) {
    try {
      await execFile(candidate, ["--version"])
      python = candidate
      break
    } catch {
      // Try the next Python executable.
    }
  }
  if (!python) return

  try {
    await execFile(python, ["-m", "venv", VENV_DIR])
    await execFile(pythonPath, ["-m", "pip", "install", "--quiet", "edge-tts"])
    logLine("edge_tts.install.success")
  } catch (error) {
    logLine("edge_tts.install.failed", error instanceof Error ? error.message : String(error))
  }
}

async function resolveEdgeTtsCommand(configured: string[] | undefined, pythonPath: string) {
  if (configured?.length) return configured
  await ensureEdgeTts(pythonPath)

  try {
    await execFile(pythonPath, ["-c", "import edge_tts"])
    return [pythonPath, "-m", "edge_tts"]
  } catch {
    // Check system installations next.
  }
  if (await commandExists("edge-tts")) return DEFAULT_EDGE_TTS_COMMAND
  try {
    await execFile("python3", ["-c", "import edge_tts"])
    return ["python3", "-m", "edge_tts"]
  } catch {
    return DEFAULT_EDGE_TTS_COMMAND
  }
}

export function audioExtension(config: TTSPluginConfig) {
  if ((config.backend ?? "edge_tts") === "edge_tts") return ".mp3"
  if (process.platform === "darwin") return ".aiff"
  return ".wav"
}

export type VoiceOption = { id: string; name: string; locale?: string; detail?: string }

export function audioGenerationErrorMessage(error: unknown) {
  const detail = error && typeof error === "object" && "stderr" in error
    ? String(error.stderr)
    : error instanceof Error ? error.message : String(error)
  if (/NoAudioReceived|No audio was received/i.test(detail)) {
    return "Edge TTS returned no audio. Try another voice or shorter text."
  }
  return "Audio generation failed. Check the speech engine and try again."
}

export function parseEdgeTtsVoices(output: string): VoiceOption[] {
  const trimmed = output.trim()
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed)
      const voices = Array.isArray(parsed) ? parsed : [parsed]
      return voices.filter((voice) => voice?.ShortName).map((voice) => ({
        id: voice.ShortName,
        name: voice.FriendlyName ?? voice.ShortName,
        locale: voice.Locale,
        detail: voice.Gender,
      }))
    } catch {
      // Some edge-tts versions print a table instead of JSON.
    }
  }

  const records: Array<Record<string, string>> = []
  const plainOutput = output.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
  const columns = /^\s*Name\s+(Gender|ContentCategories)\b/.test(plainOutput.split("\n", 1)[0] ?? "")
  if (columns) {
    for (const line of plainOutput.split("\n").slice(2)) {
      const row = /^\s*(\S+)\s+(Male|Female)\s+(.+?)\s*$/.exec(line)
      if (!row || /^[-\s]+$/.test(line)) continue
      const locale = /^[a-z]{2,3}-[A-Z]{2}/.exec(row[1])?.[0]
      records.push({ ShortName: row[1], Gender: row[2], Locale: locale ?? "" })
    }
    return records.map((voice) => ({
      id: voice.ShortName,
      name: voice.ShortName,
      locale: voice.Locale,
      detail: voice.Gender,
    }))
  }
  for (const line of plainOutput.split("\n")) {
    const entry = /^\s*([^:]+):\s*(.*?)\s*$/.exec(line)
    if (entry) {
      const key = entry[1].trim()
      if (key === "Name" && records.at(-1) && Object.keys(records.at(-1)!).length > 1) records.push({})
      const current = records.at(-1)
      if (current) current[key] = entry[2]
      else records.push({ [key]: entry[2] })
      continue
    }

    const tableRow = /^\s*(\S+)\s+(Male|Female)\s+(.+?)\s*$/.exec(line)
    if (tableRow && !/^[-\s]+$/.test(line)) {
      const locale = /^[a-z]{2,3}-[A-Z]{2}/.exec(tableRow[1])?.[0]
      records.push({ ShortName: tableRow[1], Gender: tableRow[2], Locale: locale ?? "" })
    }
  }
  return records.filter((voice) => voice.ShortName).map((voice) => ({
    id: voice.ShortName,
    name: voice.FriendlyName ?? voice.Name ?? voice.ShortName,
    locale: voice.Locale,
    detail: voice.Gender,
  }))
}

export function parseSayVoices(output: string): VoiceOption[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*(\S+)\s+(\S+)\s+#\s*(.*)$/.exec(line)
    return match ? [{ id: match[1], name: match[1], locale: match[2], detail: match[3] }] : []
  })
}

export function parseEspeakVoices(output: string): VoiceOption[] {
  return output.split("\n").flatMap((line) => {
    const match = /^\s*\d+\s+(\S+)\s+([MF])\s+(.+?)\s+(\S+)\s*$/.exec(line)
    return match ? [{ id: match[4], name: match[3].trim(), locale: match[1], detail: match[2] }] : []
  })
}

export async function previewVoice(voice: string, config: TTSPluginConfig, options: PlaybackOptions = {}) {
  const filePath = path.join(os.tmpdir(), `tts-oc-voice-preview-${process.pid}-${randomUUID()}${audioExtension(config)}`)
  try {
    await createAudioFile("Hello. This is a sample of the selected voice.", filePath, config, voice)
    await playAudioFile(filePath, options)
  } finally {
    try { unlinkSync(filePath) } catch { /* Ignore temporary preview cleanup failures. */ }
  }
}

export async function listVoices(config: TTSPluginConfig): Promise<VoiceOption[]> {
  if ((config.backend ?? "edge_tts") === "edge_tts") {
    const command = await resolveEdgeTtsCommand(config.edge_tts?.command, pythonPaths().python)
    const result = await execFile(command[0], [...command.slice(1), "--list-voices"])
    return parseEdgeTtsVoices(result.stdout)
  }
  if (process.platform === "darwin") {
    const result = await execFile("/usr/bin/say", ["-v", "?"])
    return parseSayVoices(result.stdout)
  }
  if (await commandExists("espeak")) {
    const result = await execFile("espeak", ["--voices"])
    return parseEspeakVoices(result.stdout)
  }
  throw new Error("No voice-list command is available for the configured speech engine.")
}

export type PlaybackOptions = { signal?: AbortSignal; onStart?: () => void }

export async function playAudioFile(filePath: string, options: PlaybackOptions = {}) {
  const play = async (command: string, args: string[]) => {
    options.signal?.throwIfAborted()
    const playback = execFile(command, args, { signal: options.signal, killSignal: "SIGKILL" })
    playback.child.once("spawn", () => options.onStart?.())
    await playback
  }
  logLine("tts.playback.start", { filePath })
  if (process.platform === "darwin") {
    await play("/usr/bin/afplay", [filePath])
    return
  }
  if (await commandExists("ffplay")) {
    await play("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath])
    return
  }
  if (await commandExists("mpg123") && path.extname(filePath) === ".mp3") {
    await play("mpg123", ["-q", filePath])
    return
  }
  if (await commandExists("aplay")) {
    await play("aplay", ["-q", filePath])
    return
  }
  throw new Error("No audio player found. Install `afplay`, `ffplay`, or `aplay`.")
}

export async function createAudioFile(text: string, outputPath: string, config: TTSPluginConfig, voice?: string) {
  const normalized = text.trim()
  if (!normalized) throw new Error("There is no text to speak.")
  mkdirSync(path.dirname(outputPath), { recursive: true })
  const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp${path.extname(outputPath)}`
  const backend = config.backend ?? "edge_tts"
  const pythonPath = pythonPaths().python

  try {
    if (backend === "edge_tts") {
      const command = await resolveEdgeTtsCommand(config.edge_tts?.command, pythonPath)
      const edgeVoice = voice ?? config.voice ?? config.edge_tts?.voice ?? DEFAULT_EDGE_TTS_VOICE
      const rate = config.edge_tts?.rate ?? DEFAULT_EDGE_TTS_RATE
      const volume = config.edge_tts?.volume ?? DEFAULT_EDGE_TTS_VOLUME
      logLine("tts.edge_tts.start", { command, voice: edgeVoice })
      await execFile(command[0], [...command.slice(1), "--voice", edgeVoice, "--rate", rate, "--volume", volume, "--text", normalized, "--write-media", temporaryPath])
    } else if (process.platform === "darwin") {
      const sayVoice = voice ?? config.voice
      const args = sayVoice ? ["-v", sayVoice, "-o", temporaryPath, normalized] : ["-o", temporaryPath, normalized]
      await execFile("/usr/bin/say", args)
    } else if (await commandExists("espeak")) {
      const espeakVoice = voice ?? config.voice
      const args = espeakVoice ? ["-v", espeakVoice, "-w", temporaryPath, normalized] : ["-w", temporaryPath, normalized]
      await execFile("espeak", args)
    } else {
      throw new Error("The configured system speech tool cannot create cached audio here. Install Edge TTS or espeak.")
    }

    renameSync(temporaryPath, outputPath)
    logLine("tts.audio.cached", { outputPath })
  } catch (error) {
    try {
      unlinkSync(temporaryPath)
    } catch {
      // Ignore cleanup failures for temporary audio files.
    }
    const message = audioGenerationErrorMessage(error)
    logLine("tts.audio.create.failed", { message })
    throw new Error(message)
  }
}
