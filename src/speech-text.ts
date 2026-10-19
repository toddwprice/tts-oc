export function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function stripThinkingTags(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/<\/?think>/gi, " ")
    .replace(/<reflection>[\s\S]*?<\/reflection>/gi, " ")
    .replace(/<\/?reflection>/gi, " ")
}

function markdownToSpeech(value: string) {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/gm, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*[-*_]{3,}\s*$/gm, " ")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*[-| :]+\s*$/gm, " ")
    .replace(/^\s*\|\s*/gm, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/_(.*?)_/g, "$1")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, " and ")
    .replace(/&lt;/gi, " less than ")
    .replace(/&gt;/gi, " greater than ")
    .replace(/&quot;/gi, " ")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[|*_#>`~]/g, " ")
    .replace(/\s+([.!?,;:])/g, "$1")
    .replace(/([.!?])(?=\S)/g, "$1 ")
}

export function sanitizeForSpeech(value: string) {
  return normalizeText(markdownToSpeech(stripThinkingTags(value)))
}

export function fallbackSummaryFromText(text: string) {
  const normalized = sanitizeForSpeech(
    text.replace(/^\s{0,3}#{1,6}\s*(.+?)\s*$/gm, "$1."),
  )
  if (!normalized) return ""

  const sentences = normalized.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [normalized]
  return sentences.slice(0, 2).map((sentence) => sentence.trim()).join(" ")
}
