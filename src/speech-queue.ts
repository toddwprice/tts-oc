import { closeSync, constants, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeSync } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"

type QueueOptions = {
  pollIntervalMs?: number
  processAlive?: (pid: number) => boolean
}

type QueueEntry = {
  name: string
  pid: number
  createdAt: bigint
}

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

function listQueueEntries(directory: string, isAlive: (pid: number) => boolean): QueueEntry[] {
  const entries: QueueEntry[] = []
  for (const name of readdirSync(directory)) {
    const match = /^request-(\d+)-(\d+)-([\w-]+)$/.exec(name)
    if (!match) continue

    const pid = Number(match[2])
    const filePath = path.join(directory, name)
    if (!isAlive(pid)) {
      try {
        unlinkSync(filePath)
      } catch {
        // Another queue process already removed this request.
      }
      continue
    }

    try {
      const stats = statSync(filePath, { bigint: true })
      entries.push({ name, pid, createdAt: stats.ctimeNs })
    } catch {
      // The request can disappear while the queue is read.
    }
  }

  return entries.sort((left, right) => {
    if (left.createdAt < right.createdAt) return -1
    if (left.createdAt > right.createdAt) return 1
    return left.name.localeCompare(right.name)
  })
}

function tryClaimActivePlayback(directory: string, ticket: string, isAlive: (pid: number) => boolean) {
  const lockPath = path.join(directory, "speaking.lock")
  try {
    const descriptor = openSync(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    try {
      writeSync(descriptor, JSON.stringify({ pid: process.pid, ticket }))
    } finally {
      closeSync(descriptor)
    }
    return lockPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
  }

  let owner: { pid?: number }
  try {
    owner = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number }
  } catch {
    return undefined
  }

  if (typeof owner.pid !== "number" || isAlive(owner.pid)) return undefined

  // Only the first live queue request reaches this recovery path.
  try {
    unlinkSync(lockPath)
  } catch {
    // Retry after the next queue poll.
  }
  return undefined
}

function delay(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function runWithSpeechQueue<T>(
  directory: string,
  speak: () => Promise<T>,
  options: QueueOptions = {},
): Promise<T> {
  mkdirSync(directory, { recursive: true })
  const pollIntervalMs = options.pollIntervalMs ?? 50
  const isAlive = options.processAlive ?? processIsAlive
  const ticket = `request-${Date.now().toString().padStart(13, "0")}-${process.pid}-${randomUUID()}`
  const ticketPath = path.join(directory, ticket)
  const ticketDescriptor = openSync(ticketPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  closeSync(ticketDescriptor)

  let lockPath: string | undefined
  try {
    while (!lockPath) {
      const first = listQueueEntries(directory, isAlive)[0]
      if (first?.name === ticket) lockPath = tryClaimActivePlayback(directory, ticket, isAlive)
      if (!lockPath) await delay(pollIntervalMs)
    }

    return await speak()
  } finally {
    if (lockPath) {
      try {
        const owner = JSON.parse(readFileSync(lockPath, "utf8")) as { ticket?: string }
        if (owner.ticket === ticket) unlinkSync(lockPath)
      } catch {
        // The active lock can already be absent after external cleanup.
      }
    }
    try {
      unlinkSync(ticketPath)
    } catch {
      // The request can already be absent after stale-request cleanup.
    }
  }
}
