import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { logLine, PLUGIN_DATA_DIR } from "./runtime-config.ts"
import type { VoiceOption } from "./audio.ts"

export const KOKORO_MODEL_ID = "onnx-community/Kokoro-82M-v1.0-ONNX"
export const KOKORO_DEFAULT_VOICE = "af_heart"

type KokoroVoice = { name: string; language: string; gender: string }
type KokoroModel = {
  voices: Record<string, KokoroVoice>
  generate(text: string, options: { voice: string }): Promise<{ toWav(): ArrayBuffer }>
}
type LoadKokoroModel = () => Promise<KokoroModel>

const KOKORO_VOICES: Record<string, KokoroVoice> = {
  af_heart: { name: "Heart", language: "en-us", gender: "Female" },
  af_alloy: { name: "Alloy", language: "en-us", gender: "Female" },
  af_aoede: { name: "Aoede", language: "en-us", gender: "Female" },
  af_bella: { name: "Bella", language: "en-us", gender: "Female" },
  af_jessica: { name: "Jessica", language: "en-us", gender: "Female" },
  af_kore: { name: "Kore", language: "en-us", gender: "Female" },
  af_nicole: { name: "Nicole", language: "en-us", gender: "Female" },
  af_nova: { name: "Nova", language: "en-us", gender: "Female" },
  af_river: { name: "River", language: "en-us", gender: "Female" },
  af_sarah: { name: "Sarah", language: "en-us", gender: "Female" },
  af_sky: { name: "Sky", language: "en-us", gender: "Female" },
  am_adam: { name: "Adam", language: "en-us", gender: "Male" },
  am_echo: { name: "Echo", language: "en-us", gender: "Male" },
  am_eric: { name: "Eric", language: "en-us", gender: "Male" },
  am_fenrir: { name: "Fenrir", language: "en-us", gender: "Male" },
  am_liam: { name: "Liam", language: "en-us", gender: "Male" },
  am_michael: { name: "Michael", language: "en-us", gender: "Male" },
  am_onyx: { name: "Onyx", language: "en-us", gender: "Male" },
  am_puck: { name: "Puck", language: "en-us", gender: "Male" },
  am_santa: { name: "Santa", language: "en-us", gender: "Male" },
  bf_emma: { name: "Emma", language: "en-gb", gender: "Female" },
  bf_isabella: { name: "Isabella", language: "en-gb", gender: "Female" },
  bm_george: { name: "George", language: "en-gb", gender: "Male" },
  bm_lewis: { name: "Lewis", language: "en-gb", gender: "Male" },
  bf_alice: { name: "Alice", language: "en-gb", gender: "Female" },
  bf_lily: { name: "Lily", language: "en-gb", gender: "Female" },
  bm_daniel: { name: "Daniel", language: "en-gb", gender: "Male" },
  bm_fable: { name: "Fable", language: "en-gb", gender: "Male" },
}

export const KOKORO_VOICE_OPTIONS: VoiceOption[] = Object.entries(KOKORO_VOICES).map(([id, voice]) => ({
  id,
  name: voice.name,
  locale: voice.language,
  detail: voice.gender,
  backend: "kokoro",
}))

const KOKORO_CACHE_DIR = path.join(PLUGIN_DATA_DIR, "kokoro-cache")
let modelPromise: Promise<KokoroModel> | undefined

export function loadKokoroModel(): Promise<KokoroModel> {
  if (!modelPromise) {
    logLine("tts.kokoro.model.load.start", { model: KOKORO_MODEL_ID })
    modelPromise = (async () => {
      mkdirSync(KOKORO_CACHE_DIR, { recursive: true })
      const { env } = await import("@huggingface/transformers")
      env.cacheDir = KOKORO_CACHE_DIR
      const { KokoroTTS } = await import("kokoro-js")
      const model = await KokoroTTS.from_pretrained(KOKORO_MODEL_ID, { dtype: "q8", device: "cpu" }) as KokoroModel
      logLine("tts.kokoro.model.load.success", { model: KOKORO_MODEL_ID })
      return model
    })().catch((error) => {
      modelPromise = undefined
      logLine("tts.kokoro.model.load.failed", { error: error instanceof Error ? error.message : String(error) })
      throw error
    })
  }
  return modelPromise
}

export async function createKokoroAudioFile(
  text: string,
  outputPath: string,
  voice: string,
  loadModel: LoadKokoroModel = loadKokoroModel,
) {
  const model = await loadModel()
  if (!(voice in model.voices)) throw new Error(`Unknown Kokoro voice: ${voice}`)
  const audio = await model.generate(text, { voice })
  writeFileSync(outputPath, Buffer.from(audio.toWav()))
}
