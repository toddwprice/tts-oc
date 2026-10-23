import { createHash } from "node:crypto"
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs"
import path from "node:path"

export const DEFAULT_CACHE_RETENTION_DAYS = 3

export function cachedAudioPath(directory: string, messageID: string, mode: "full" | "summary", extension: string) {
  const key = createHash("sha256").update(`${messageID}\0${mode}`).digest("hex")
  const safeExtension = /^\.[a-z0-9]+$/i.test(extension) ? extension : ".audio"
  return path.join(directory, `${mode}-${key}${safeExtension}`)
}

export function cacheRetentionMs(value: number | undefined) {
  const days = typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : DEFAULT_CACHE_RETENTION_DAYS
  return days * 24 * 60 * 60 * 1000
}

export function cleanupAudioCache(directory: string, retentionDays?: number, now = Date.now()) {
  mkdirSync(directory, { recursive: true })
  const expiresBefore = now - cacheRetentionMs(retentionDays)
  let removed = 0
  for (const name of readdirSync(directory)) {
    const filePath = path.join(directory, name)
    try {
      const stats = statSync(filePath)
      if (!stats.isFile() || stats.mtimeMs > expiresBefore) continue
      unlinkSync(filePath)
      removed++
    } catch {
      // Ignore files that change during cleanup.
    }
  }
  return removed
}

export function clearAudioCache(directory: string) {
  mkdirSync(directory, { recursive: true })
  let removed = 0
  for (const name of readdirSync(directory)) {
    const filePath = path.join(directory, name)
    try {
      if (!statSync(filePath).isFile()) continue
      unlinkSync(filePath)
      removed++
    } catch {
      // Ignore files that change or disappear during cache clearing.
    }
  }
  return removed
}
