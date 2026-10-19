import { closeSync, constants, mkdirSync, openSync, unlinkSync } from "node:fs"
import path from "node:path"

type SpeechClaim = {
  complete(): void
  release(): void
}

export function claimSpeech(messageID: string, directory: string): SpeechClaim | undefined {
  mkdirSync(directory, { recursive: true })
  const claimPath = path.join(directory, `${encodeURIComponent(messageID)}.lock`)

  let descriptor: number
  try {
    descriptor = openSync(claimPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return undefined
    throw error
  }

  closeSync(descriptor)
  let claimed = true
  let completed = false

  const removeClaim = () => {
    if (!claimed || completed) return
    claimed = false
    try {
      unlinkSync(claimPath)
    } catch {
      // The claim can already be absent after external cleanup.
    }
  }

  return {
    complete() {
      completed = true
    },
    release: removeClaim,
  }
}
