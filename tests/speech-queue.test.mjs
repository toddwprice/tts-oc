import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import test from "node:test"
import { runWithSpeechQueue } from "../src/speech-queue.ts"

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

test("runs queued speech one at a time in request order", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-tts-queue-test-"))
  const events = []

  try {
    const first = runWithSpeechQueue(directory, async () => {
      events.push("first:start")
      await delay(30)
      events.push("first:end")
    }, { pollIntervalMs: 5 })
    const second = runWithSpeechQueue(directory, async () => {
      events.push("second:start")
      await delay(5)
      events.push("second:end")
    }, { pollIntervalMs: 5 })

    await Promise.all([first, second])
    assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("releases the queue when speech fails", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-tts-queue-test-"))
  const events = []

  try {
    const first = runWithSpeechQueue(directory, async () => {
      events.push("first:start")
      throw new Error("playback failed")
    }, { pollIntervalMs: 5 })
    const second = runWithSpeechQueue(directory, async () => {
      events.push("second:start")
      return "spoken"
    }, { pollIntervalMs: 5 })

    const [firstResult, secondResult] = await Promise.allSettled([first, second])
    assert.equal(firstResult.status, "rejected")
    assert.equal(secondResult.status, "fulfilled")
    assert.deepEqual(events, ["first:start", "second:start"])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("queues speech from separate processes", async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "opencode-tts-queue-test-"))
  const logPath = path.join(directory, "events.log")
  const modulePath = new URL("../src/speech-queue.ts", import.meta.url).href
  const childCode = `
    import { appendFileSync } from "node:fs";
    import { runWithSpeechQueue } from ${JSON.stringify(modulePath)};
    const [directory, logPath, name] = process.argv.slice(1);
    await runWithSpeechQueue(directory, async () => {
      appendFileSync(logPath, name + ":start\\n");
      console.log("started");
      await new Promise((resolve) => setTimeout(resolve, 100));
      appendFileSync(logPath, name + ":end\\n");
    }, { pollIntervalMs: 5 });
  `

  const startChild = () => spawn(process.execPath, [...process.execArgv, "--input-type=module", "-e", childCode, directory, logPath, "child"], {
    stdio: ["ignore", "pipe", "inherit"],
  })

  try {
    const first = startChild()
    await new Promise((resolve, reject) => {
      first.stdout.once("data", resolve)
      first.once("error", reject)
      first.once("exit", (code) => {
        if (code !== 0) reject(new Error(`first child exited with code ${code}`))
      })
    })

    const second = startChild()
    await Promise.all([first, second].map((child) => new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`child exited with code ${code}`)))
    })))

    assert.equal(readFileSync(logPath, "utf8"), "child:start\nchild:end\nchild:start\nchild:end\n")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
