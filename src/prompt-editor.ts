import { spawn as spawnCallback } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"

type RunEditor = (command: string, args: string[]) => Promise<void>

type EditPromptOptions = {
  editor?: string
  initialPrompt?: string
  directory?: string
  runEditor?: RunEditor
}

function parseEditorCommand(value: string) {
  const args: string[] = []
  let current = ""
  let quote: "'" | '"' | undefined
  let escaping = false
  let started = false

  for (const character of value) {
    if (escaping) {
      current += character
      escaping = false
      started = true
    } else if (character === "\\" && quote !== "'") {
      escaping = true
      started = true
    } else if (quote) {
      if (character === quote) quote = undefined
      else current += character
      started = true
    } else if (character === "'" || character === '"') {
      quote = character
      started = true
    } else if (/\s/.test(character)) {
      if (started) args.push(current)
      current = ""
      started = false
    } else {
      current += character
      started = true
    }
  }

  if (escaping || quote) throw new Error("Invalid EDITOR command. Check its quotes and backslashes.")
  if (started) args.push(current)
  if (args.length === 0 || !args[0]) throw new Error("Set EDITOR to the command for your text editor.")
  return args
}

function runEditor(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    let settled = false
    const child = spawnCallback(command, args, { stdio: "inherit", env: process.env })
    child.once("error", (error) => {
      settled = true
      reject(error)
    })
    child.once("close", (code, signal) => {
      if (settled) return
      settled = true
      if (code === 0) resolve()
      else reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `status ${code ?? "unknown"}`}.`))
    })
  })
}

export async function editPromptInEditor({
  editor = process.env.EDITOR,
  initialPrompt = "",
  directory = os.tmpdir(),
  runEditor: launchEditor = runEditor,
}: EditPromptOptions = {}) {
  const command = parseEditorCommand(editor ?? "")
  const temporaryDirectory = mkdtempSync(path.join(directory, "tts-oc-prompt-"))
  const promptPath = path.join(temporaryDirectory, "summary-prompt.txt")

  try {
    writeFileSync(promptPath, initialPrompt, "utf8")
    await launchEditor(command[0], [...command.slice(1), promptPath])
    return readFileSync(promptPath, "utf8")
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true })
  }
}
