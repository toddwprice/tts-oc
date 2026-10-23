import { randomUUID } from "node:crypto"
import { execFile as execFileCallback } from "node:child_process"
import { mkdirSync, renameSync, unlinkSync } from "node:fs"
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

export async function playAudioFile(filePath: string) {
  logLine("tts.playback.start", { filePath })
  if (process.platform === "darwin") {
    await execFile("/usr/bin/afplay", [filePath])
    return
  }
  if (await commandExists("ffplay")) {
    await execFile("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", filePath])
    return
  }
  if (await commandExists("mpg123") && path.extname(filePath) === ".mp3") {
    await execFile("mpg123", ["-q", filePath])
    return
  }
  if (await commandExists("aplay")) {
    await execFile("aplay", ["-q", filePath])
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
      const args = config.voice ? ["-v", config.voice, "-w", temporaryPath, normalized] : ["-w", temporaryPath, normalized]
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
    logLine("tts.audio.create.failed", { error: error instanceof Error ? error.message : String(error) })
    throw error
  }
}
