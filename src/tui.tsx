import { Plugin, usePlugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import type { SlotMap } from "@opencode/plugin/tui/context"
import { speakLatestResponse, type SpeechMode } from "./speech-actions.js"
import { AUDIO_CACHE_DIR, configFromPluginOptions, initializeRuntimeConfig, logLine, SPEECH_QUEUE_DIR } from "./runtime-config.js"
import { runWithSpeechQueue } from "./speech-queue.js"
import { cleanupAudioCache } from "./speech-cache.js"

type ComposerInput = SlotMap["session.composer.top"] & {
  summaryModel: { summaryProvider?: string; summaryModel?: string }
  config: ReturnType<typeof configFromPluginOptions>
}

function SpeechControls(props: ComposerInput) {
  const context = usePlugin()
  const [busy, setBusy] = createSignal(false)
  const act = async (mode: SpeechMode) => {
    if (busy()) return
    setBusy(true)
    try {
      const result = await speakLatestResponse({
        client: context.client,
        sessionID: props.sessionID,
        mode,
        summaryModel: props.summaryModel,
        config: props.config,
      })
      context.ui.toast.show({
        message: result.message,
        variant: result.ok ? "success" : "warning",
        sessionID: props.sessionID,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logLine("ui.speak.error", { sessionID: props.sessionID, mode, message })
      context.ui.toast.show({ message: `Speech failed: ${message}`, variant: "error", sessionID: props.sessionID })
    } finally {
      setBusy(false)
    }
  }

  context.keymap.layer(() => ({
    mode: "global",
    priority: 20,
    commands: [
      {
        id: "tts-oc.speak-response",
        title: "Speak Response",
        group: "Text to Speech",
        bind: "ctrl+shift+r",
        palette: true,
        enabled: () => !busy(),
        run: () => void act("full"),
      },
      {
        id: "tts-oc.speak-summary",
        title: "Speak Summary",
        group: "Text to Speech",
        bind: "ctrl+shift+s",
        palette: true,
        enabled: () => !busy(),
        run: () => void act("summary"),
      },
    ],
    bindings: ["tts-oc.speak-response", "tts-oc.speak-summary"],
  }))

  const handleMouse = (mode: SpeechMode) => (event: { button: number }) => {
    if (event.button !== 0) return
    void act(mode)
  }
  return (
    <box flexDirection="row" gap={1} paddingLeft={1} paddingRight={1}>
      <box border paddingLeft={1} paddingRight={1} visible={!busy()} onMouseUp={handleMouse("full")}>
        <text selectable={false} fg={context.theme.text.base}>{busy() ? "Speaking…" : "Speak Response"}</text>
      </box>
      <box border paddingLeft={1} paddingRight={1} visible={!busy()} onMouseUp={handleMouse("summary")}>
        <text selectable={false} fg={context.theme.text.base}>{busy() ? "Speaking…" : "Speak Summary"}</text>
      </box>
    </box>
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
