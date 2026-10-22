import assert from "node:assert/strict"
import test from "node:test"
import { build } from "esbuild"

async function setup(context) {
  const bundle = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [{
      name: "plugin-context",
      setup(builder) {
        builder.onResolve({ filter: /^@opencode\/plugin$/ }, () => ({ path: "plugin", namespace: "test" }))
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: "export const Plugin = { define: value => value }",
        }))
      },
    }],
  })
  const { default: plugin } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${Math.random()}`)
  const commands = new Map()
  const results = []
  const cleanup = await plugin.setup({
    options: {},
    location: { directory: process.cwd() },
    event: { async *subscribe() {} },
    command: { async transform(edit) { edit({ add(command) { commands.set(command.name, command) } }) } },
    session: {
      context,
      async prompt(input) { results.push(input) },
    },
  })
  return { commands, results, cleanup }
}

test("tts-play checks only the requested session and reports an empty conversation", async () => {
  const state = await setup(async (input) => {
    assert.deepEqual(input, { sessionID: "chosen-session" })
    return []
  })
  try {
    assert.ok(state.commands.has("tts-repeat"))
    assert.ok(state.commands.has("tts-play"))
    await state.commands.get("tts-play").execute({ sessionID: "chosen-session", prompt: { text: "" }, delivery: "queue" })
    assert.equal(state.results.length, 1)
    assert.equal(state.results[0].delivery, "queue")
    assert.match(state.results[0].text, /No assistant response is available to play/)
  } finally {
    state.cleanup()
  }
})

test("tts-play reports playback errors", async () => {
  const state = await setup(async () => { throw new Error("Context unavailable") })
  try {
    assert.ok(state.commands.has("tts-play"))
    await state.commands.get("tts-play").execute({ sessionID: "chosen-session", prompt: { text: "" }, delivery: "steer" })
    assert.match(state.results[0].text, /Text-to-speech command failed: Context unavailable/)
  } finally {
    state.cleanup()
  }
})
