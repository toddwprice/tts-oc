export type SummaryModel = {
  providerID: string
  modelID: string
}

export async function generateSummary(
  summaryProvider: string | undefined,
  summaryModel: string | undefined,
  source: SummaryModel | undefined,
  generate: (model: SummaryModel) => Promise<string>,
  onFailure?: (model: SummaryModel, error: unknown) => void,
): Promise<string> {
  const providerID = summaryProvider?.trim()
  const modelID = summaryModel?.trim()
  const preferred = providerID && modelID ? { providerID, modelID } : undefined
  const models: SummaryModel[] = []
  if (preferred) models.push(preferred)
  if (source && !models.some((model) => model.providerID === source.providerID && model.modelID === source.modelID)) {
    models.push(source)
  }

  let lastError: unknown = new Error("no model available for summarization")
  for (const model of models) {
    try {
      const summary = await generate(model)
      if (!summary.trim()) throw new Error("summary model returned no text")
      return summary
    } catch (error) {
      lastError = error
      onFailure?.(model, error)
    }
  }
  throw lastError
}
