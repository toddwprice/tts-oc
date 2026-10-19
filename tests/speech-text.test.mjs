import assert from "node:assert/strict"
import test from "node:test"
import { fallbackSummaryFromText, sanitizeForSpeech } from "../src/speech-text.ts"

test("speech text removes markdown syntax and link destinations", () => {
  const markdown = "## Recommended approach\n\nKeep the **first draft**. Read [the guide](https://example.com/docs)."

  assert.equal(
    sanitizeForSpeech(markdown),
    "Recommended approach Keep the first draft. Read the guide.",
  )
})

test("speech text skips code blocks and markdown table dividers", () => {
  const markdown = [
    "Use this setting.",
    "```ts",
    "const enabled = true",
    "```",
    "| Mode | Status |",
    "| --- | --- |",
    "| summary | on |",
  ].join("\n")

  assert.equal(sanitizeForSpeech(markdown), "Use this setting. Mode Status summary on")
})

test("fallback summary uses complete sentences without markdown markers", () => {
  const markdown = "## Result\nThe command worked. The setting is now on. More detail follows here."

  assert.equal(fallbackSummaryFromText(markdown), "Result. The command worked.")
})
