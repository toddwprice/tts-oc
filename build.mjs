import { build } from "esbuild"
import { transformAsync } from "@babel/core"
import { readFileSync } from "node:fs"
import ts from "@babel/preset-typescript"
import moduleResolver from "babel-plugin-module-resolver"
import solid from "babel-preset-solid"

const output = await transformAsync(readFileSync("src/tui.tsx", "utf8"), {
  filename: "src/tui.tsx",
  configFile: false,
  babelrc: false,
  plugins: [[moduleResolver, {
    resolvePath(specifier) {
      if (specifier === "solid-js") return "solid-js/dist/solid.js"
      if (specifier === "solid-js/store") return "solid-js/store/dist/store.js"
      return specifier
    },
  }]],
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
  external: ["@opencode/plugin/tui", "@opencode/plugin/tui/context", "@opencode/client", "@opentui/core", "@opentui/solid", "solid-js", "solid-js/store", "solid-js/dist/solid.js", "solid-js/store/dist/store.js"],
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
