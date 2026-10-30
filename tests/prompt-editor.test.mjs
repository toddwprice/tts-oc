import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { editPromptInEditor } from "../src/prompt-editor.ts"

test("opens the current prompt in the configured editor and returns the edited text", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-prompt-editor-test-"))
  const editorCalls = []
  try {
    const prompt = await editPromptInEditor({
      editor: '"custom editor" --wait',
      initialPrompt: "Current {{response}}",
      directory,
      async runEditor(executable, args) {
        editorCalls.push({ executable, args: args.slice(0, -1) })
        assert.equal(readFileSync(args.at(-1), "utf8"), "Current {{response}}")
        writeFileSync(args.at(-1), "Edited {{response}}\n")
      },
    })

    assert.equal(prompt, "Edited {{response}}\n")
    assert.deepEqual(editorCalls, [{ executable: "custom editor", args: ["--wait"] }])
    assert.deepEqual(readdirSync(directory), [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("requires EDITOR and cleans up the temporary prompt if the editor fails", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "tts-oc-prompt-editor-test-"))
  try {
    await assert.rejects(editPromptInEditor({ directory, editor: "  " }), /Set EDITOR/)
    await assert.rejects(editPromptInEditor({
      directory,
      editor: "editor",
      async runEditor() { throw new Error("editor failed") },
    }), /editor failed/)
    assert.deepEqual(readdirSync(directory), [])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("rejects an editor command with unmatched quotes", async () => {
  await assert.rejects(editPromptInEditor({ editor: '"unfinished' }), /Invalid EDITOR command/)
})
