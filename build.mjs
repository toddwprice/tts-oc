import { build } from "esbuild"
import { transformAsync } from "@babel/core"
import { readFileSync } from "node:fs"
import ts from "@babel/preset-typescript"
import solid from "babel-preset-solid"

const output = await transformAsync(readFileSync("src/tui.tsx", "utf8"), {
  filename: "src/tui.tsx",
  configFile: false,
  babelrc: false,
  presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], [ts]],
})

await build({
  entryPoints: ["src/tui.tsx"],
  outfile: "dist/tui.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  plugins: [{
    name: "solid-jsx",
    setup(builder) {
      builder.onLoad({ filter: /src\/tui\.tsx$/ }, () => ({ contents: output?.code ?? "", loader: "tsx" }))
    },
  }],
  external: ["@opencode/plugin/tui", "@opencode/plugin/tui/context", "@opencode/client", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/store"],
})

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  sourcemap: true,
  external: ["@opencode/plugin", "@opencode/plugin/tui", "@opencode/plugin/tui/context", "@opencode/client", "@opencode-ai/plugin", "@opencode-ai/sdk"],
})
