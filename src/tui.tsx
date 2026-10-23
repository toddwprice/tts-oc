import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { Show, createSignal } from "solid-js"
import type { SlotMap } from "@opencode/plugin/tui/context"
import { previewVoice, listVoices } from "./audio.js"
import { audioGenerationErrorMessage } from "./audio.js"
import { speakLatestResponse, type SpeechMode } from "./speech-actions.js"
import { AUDIO_CACHE_DIR, configFromPluginOptions, initializeRuntimeConfig, logLine, saveVoiceSelection, SPEECH_QUEUE_DIR } from "./runtime-config.js"
import { runWithSpeechQueue } from "./speech-queue.js"
import { clearAudioCache, cleanupAudioCache } from "./speech-cache.js"

type ComposerInput = SlotMap["session.composer.top"] & {
  summaryModel: { summaryProvider?: string; summaryModel?: string }
  config: ReturnType<typeof configFromPluginOptions>
}

function SpeechControls(props: ComposerInput) {
  const context = usePlugin()
  const [agentWorking, setAgentWorking] = createSignal(context.data.session.status(props.sessionID) === "running")
  const [busy, setBusy] = createSignal(false)
  const [activeMode, setActiveMode] = createSignal<SpeechMode>()
  const [playing, setPlaying] = createSignal(false)
  let playbackController: AbortController | undefined
  const [hovered, setHovered] = createSignal<SpeechMode>()
  const browseVoices = async () => {
    try {
      const voices = await listVoices(props.config)
      if (voices.length === 0) {
        context.ui.toast.show({ message: "The current speech engine returned no voices.", variant: "warning" })
        return
      }
      const selectedVoice = await context.ui.dialog.select({
        title: "Speech voices",
        placeholder: "Search voices by name, language, or voice ID",
        current: props.config.voice ?? props.config.edge_tts?.voice,
        options: voices.map((voice) => ({
          title: voice.name,
          value: voice.id,
          description: [voice.locale, voice.detail, voice.id].filter(Boolean).join(" · "),
          footer: voice.id === (props.config.voice ?? props.config.edge_tts?.voice) ? "Current voice" : undefined,
        })),
        search: (query, options) => {
          const normalized = query.toLowerCase()
          return options.filter((option) => `${option.title} ${option.description ?? ""}`.toLowerCase().includes(normalized))
        },
        actions: [{
          bind: "ctrl+o",
          title: "Preview sample",
          onTrigger: (voice) => {
            context.ui.toast.show({ message: `Preparing a sample for ${voice}…`, variant: "success" })
            void runWithSpeechQueue(SPEECH_QUEUE_DIR, () => previewVoice(voice, props.config)).then(
              () => context.ui.toast.show({ message: `Finished sample for ${voice}.`, variant: "success" }),
              (error) => context.ui.toast.show({
                message: `Voice sample failed: ${error instanceof Error ? error.message : String(error)}`,
                variant: "error",
              }),
            )
          },
        }],
      })
      if (!selectedVoice) return
      saveVoiceSelection(selectedVoice)
      props.config.voice = selectedVoice
      context.ui.toast.show({ message: `Saved voice ${selectedVoice}.`, variant: "success" })
    } catch (error) {
      context.ui.toast.show({
        message: `Voice browser failed: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }
  const clearCache = async () => {
    const confirmed = await context.ui.dialog.confirm({
      title: "Clear cached audio?",
      message: "Remove all cached speech audio? The plugin will create audio again on the next request.",
      label: { confirm: "Clear cache", cancel: "Cancel" },
    })
    if (!confirmed) return
    try {
      const removed = await runWithSpeechQueue(SPEECH_QUEUE_DIR, async () => clearAudioCache(AUDIO_CACHE_DIR))
      context.ui.toast.show({
        message: removed === 0 ? "No cached audio files to remove." : `Removed ${removed} cached audio file${removed === 1 ? "" : "s"}.`,
        variant: "success",
      })
    } catch (error) {
      context.ui.toast.show({
        message: `Could not clear cached audio: ${error instanceof Error ? error.message : String(error)}`,
        variant: "error",
      })
    }
  }
  context.data.on("session.execution.started", (event) => {
    if (event.data.sessionID === props.sessionID) setAgentWorking(true)
  })
  const markIdle = (event: { data: { sessionID: string } }) => {
    if (event.data.sessionID === props.sessionID) setAgentWorking(false)
  }
  context.data.on("session.execution.succeeded", markIdle)
  context.data.on("session.execution.failed", markIdle)
  context.data.on("session.execution.interrupted", markIdle)
  const buttonColor = (mode: SpeechMode) => {
    if (playing() && activeMode() === mode) return hovered() === mode ? "#FFCACA" : "#D96C6C"
    if (busy()) return "#668099"
    return hovered() === mode ? "#B0E0FF" : "#87CEFA"
  }
  const buttonLabel = (mode: SpeechMode, label: string) => busy() && activeMode() === mode ? playing() ? "Stop" : "Processing…" : label
  const act = async (mode: SpeechMode) => {
    if (busy()) {
      if (playing() && activeMode() === mode) playbackController?.abort()
      return
    }
    setBusy(true)
    setActiveMode(mode)
    playbackController = new AbortController()
    try {
      const result = await speakLatestResponse({
        client: context.client,
        sessionID: props.sessionID,
        mode,
        summaryModel: props.summaryModel,
        config: props.config,
        signal: playbackController.signal,
        onPlaybackStart: () => setPlaying(true),
      })
      context.ui.toast.show({
        message: result.message,
        variant: result.ok ? "success" : "warning",
        sessionID: props.sessionID,
      })
    } catch (error) {
      const message = audioGenerationErrorMessage(error)
      logLine("ui.speak.error", { sessionID: props.sessionID, mode, message })
      context.ui.toast.show({ message, variant: "error", sessionID: props.sessionID })
    } finally {
      setBusy(false)
      setActiveMode(undefined)
      setPlaying(false)
      playbackController = undefined
    }
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 20,
    commands: [
      {
        id: "tts-oc.clear-cache",
        title: "Clear Cached Audio",
        group: "Text to Speech",
        palette: true,
        slash: { name: "tts-clear-cache" },
        run: () => void clearCache(),
      },
      {
        id: "tts-oc.browse-voices",
        title: "Browse Speech Voices",
        group: "Text to Speech",
        palette: true,
        slash: { name: "tts-voices" },
        run: () => void browseVoices(),
      },
      {
        id: "tts-oc.speak-response",
        title: "Speak Response",
        group: "Text to Speech",
        bind: "ctrl+shift+r",
        palette: true,
        slash: { name: "tts-speak-response" },
        enabled: () => !busy() || (playing() && activeMode() === "full"),
        run: () => void act("full"),
      },
      {
        id: "tts-oc.speak-summary",
        title: "Speak Summary",
        group: "Text to Speech",
        bind: "ctrl+shift+s",
        palette: true,
        slash: { name: "tts-speak-summary" },
        enabled: () => !busy() || (playing() && activeMode() === "summary"),
        run: () => void act("summary"),
      },
    ],
    bindings: ["tts-oc.clear-cache", "tts-oc.browse-voices", "tts-oc.speak-response", "tts-oc.speak-summary"],
  }))

  const handleMouse = (mode: SpeechMode) => (event: { button: number }) => {
    if (event.button !== 0) return
    void act(mode)
  }
  return (
    <Show when={!agentWorking() && props.config.buttonsVisible !== false}>
      <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
        <box border borderColor={buttonColor("full")} paddingLeft={1} paddingRight={1}
          onMouseOver={() => setHovered("full")} onMouseOut={() => setHovered(undefined)} onMouseUp={handleMouse("full")}>
          <text selectable={false} fg={buttonColor("full")}>{buttonLabel("full", "Speak Response")}</text>
        </box>
        <box border borderColor={buttonColor("summary")} paddingLeft={1} paddingRight={1}
          onMouseOver={() => setHovered("summary")} onMouseOut={() => setHovered(undefined)} onMouseUp={handleMouse("summary")}>
          <text selectable={false} fg={buttonColor("summary")}>{buttonLabel("summary", "Speak Summary")}</text>
        </box>
      </box>
    </Show>
  )
}

export default Plugin.define({
  id: "tts-oc.cli",
  setup(context) {
    initializeRuntimeConfig()
    const config = configFromPluginOptions(context.options)
    void runWithSpeechQueue(SPEECH_QUEUE_DIR, async () => {
      cleanupAudioCache(AUDIO_CACHE_DIR, config.cacheRetentionDays)
    }).catch((error) => logLine("cache.cleanup.error", error instanceof Error ? error.message : String(error)))
    const summaryModel = {
      summaryProvider: typeof context.options.summaryProvider === "string" ? context.options.summaryProvider : config.summaryProvider,
      summaryModel: typeof context.options.summaryModel === "string" ? context.options.summaryModel : config.summaryModel,
    }
    context.ui.slot({
      append: "session.composer.top",
      render: ({ sessionID }) => <SpeechControls sessionID={sessionID} summaryModel={summaryModel} config={config} />,
    })
  },
})
