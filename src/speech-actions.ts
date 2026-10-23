import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs"
import { runWithSpeechQueue } from "./speech-queue.ts"
import { fallbackSummaryFromText, sanitizeForSpeech } from "./speech-text.ts"
import { audioExtension, createAudioFile, playAudioFile } from "./audio.ts"
import { AUDIO_CACHE_DIR, loadPluginConfigFromDisk, logLine, SPEECH_QUEUE_DIR, type TTSPluginConfig } from "./runtime-config.ts"
import { cachedAudioPath, cleanupAudioCache } from "./speech-cache.ts"
import type { Context as TUIContext } from "@opencode/plugin/tui/context"
import type { SessionMessageAssistant, SessionMessageInfo } from "@opencode/client"

export type SpeechMode = "full" | "summary"

type SpeechActionDependencies = {
  client: Pick<TUIContext["client"], "session" | "generate">
  sessionID: string
  mode: SpeechMode
  cacheDirectory?: string
  queueDirectory?: string
  config?: TTSPluginConfig
  summaryModel?: { summaryProvider?: string; summaryModel?: string }
  createAudio?: typeof createAudioFile
  playAudio?: typeof playAudioFile
  signal?: AbortSignal
  onPlaybackStart?: () => void
}

export function assistantText(message: SessionMessageAssistant) {
  return sanitizeForSpeech(message.content.filter((part) => part.type === "text").map((part) => part.text ?? "").join(" "))
}

async function summarize(
  client: SpeechActionDependencies["client"],
  text: string,
  source: { providerID: string; modelID: string } | undefined,
  config: TTSPluginConfig,
  summaryModel?: { summaryProvider?: string; summaryModel?: string },
) {
  const summaryLength = config.summaryLength ?? "2 sentences"
  const prompt = [
    `Summarize the following assistant response as spoken audio copy in ${summaryLength}.`,
    "Keep concrete facts, decisions, and next actions.",
    "Do not mention that this is a summary.",
    "Paraphrase instead of copying the opening words when possible.",
    "Never output chain-of-thought, think tags, reflection tags, or XML-like tags.",
    "Do not use bullets, numbering, markdown, or preamble.",
    "Speak at an 8th grade reading level.",
    "",
    sanitizeForSpeech(text),
  ].join("\n")

  const preferredProvider = summaryModel?.summaryProvider ?? config.summaryProvider
  const preferredModel = summaryModel?.summaryModel ?? config.summaryModel
  const models = [
    ...(preferredProvider && preferredModel ? [{ providerID: preferredProvider, id: preferredModel }] : []),
    ...(source ? [{ providerID: source.providerID, id: source.modelID }] : []),
  ]
  const seen = new Set<string>()
  let lastError: unknown
  for (const model of models) {
    const key = `${model.providerID}\0${model.id}`
    if (seen.has(key)) continue
    seen.add(key)
    try {
      const response = await client.generate.text({ model, prompt })
      const value = sanitizeForSpeech(response.text)
      if (!value) throw new Error("The summary model returned no text.")
      return value
    } catch (error) {
      lastError = error
      logLine("summarize.model.error", { model, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (lastError) throw lastError
  return fallbackSummaryFromText(text)
}

export async function speakLatestResponse(dependencies: SpeechActionDependencies) {
  const client = dependencies.client
  const messages = await client.session.context({ sessionID: dependencies.sessionID })
  const latest = [...messages].reverse().find(isSpeakableMessage)
  if (!latest) return { ok: false as const, message: "No assistant response is available to speak." }
  const isAssistant = latest.type === "assistant"
  const message = latest.type === "assistant" ? latest : undefined
  const text = message ? assistantText(message) : sanitizeForSpeech((latest as CompletedCompaction).summary)
  const responseID = latest.id

  const config = { ...loadPluginConfigFromDisk(), ...dependencies.config }
  const cacheDirectory = dependencies.cacheDirectory ?? AUDIO_CACHE_DIR
  const queueDirectory = dependencies.queueDirectory ?? SPEECH_QUEUE_DIR
  const extension = audioExtension(config)
  const outputPath = cachedAudioPath(cacheDirectory, responseID, dependencies.mode, extension)
  await runWithSpeechQueue(queueDirectory, async () => {
    cleanupAudioCache(cacheDirectory, config.cacheRetentionDays)
    if (!existsSync(outputPath)) {
      mkdirSync(cacheDirectory, { recursive: true })
      let speechText = text
      if (dependencies.mode === "summary") {
        try {
          speechText = await summarize(
            client,
            text,
            message ? { providerID: message.model.providerID, modelID: message.model.id } : undefined,
            config,
            {
              summaryProvider: dependencies.summaryModel?.summaryProvider ?? config.summaryProvider,
              summaryModel: dependencies.summaryModel?.summaryModel ?? config.summaryModel,
            },
          )
        } catch (error) {
          logLine("summarize.error", { error: error instanceof Error ? error.message : String(error) })
          speechText = fallbackSummaryFromText(text)
        }
      }
      const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.pending${extension}`
      try {
        await (dependencies.createAudio ?? createAudioFile)(speechText, temporaryPath, config)
        renameSync(temporaryPath, outputPath)
      } catch (error) {
        try { unlinkSync(temporaryPath) } catch { /* Ignore temporary file cleanup failures. */ }
        throw error
      }
    }
    try {
      await (dependencies.playAudio ?? playAudioFile)(outputPath, {
        signal: dependencies.signal,
        onStart: dependencies.onPlaybackStart,
      })
    } catch (error) {
      if (!dependencies.signal?.aborted) throw error
    }
  })

  if (dependencies.signal?.aborted) return { ok: true as const, message: "Playback stopped." }
  logLine("ui.speak.success", { sessionID: dependencies.sessionID, messageID: responseID, mode: dependencies.mode, outputPath })
  return { ok: true as const, message: dependencies.mode === "full" ? "Response played." : "Summary played." }
}

type CompletedCompaction = Extract<SessionMessageInfo, { type: "compaction" }> & { status: "completed" }

function isCompletedCompaction(message: SessionMessageInfo): message is CompletedCompaction {
  return message.type === "compaction" && message.status === "completed" && Boolean(message.summary.trim())
}

function isSpeakableMessage(message: SessionMessageInfo): message is SessionMessageAssistant | CompletedCompaction {
  return message.type === "assistant"
    ? assistantText(message).length > 0
    : isCompletedCompaction(message)
}
