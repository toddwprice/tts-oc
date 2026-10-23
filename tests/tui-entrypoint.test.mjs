import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

test("local TUI discovery has a root entrypoint included in the package", () => {
  const entrypoint = readFileSync(new URL("../tui.js", import.meta.url), "utf8")
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))

  assert.equal(entrypoint.trim(), 'export { default } from "./dist/tui.js"')
  assert.ok(pkg.files.includes("tui.js"))
})
