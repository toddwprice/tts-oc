import { Plugin } from "@opencode/plugin"
import { initializeRuntimeConfig, logLine } from "./runtime-config.js"

export default Plugin.define({
  id: "tts-oc",
  setup() {
    initializeRuntimeConfig()
    logLine("server.plugin.setup")
  },
})
