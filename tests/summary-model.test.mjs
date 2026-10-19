import assert from "node:assert/strict"
import test from "node:test"
import { generateSummary } from "../src/summary-model.ts"

const source = { providerID: "ganglia", modelID: "gpt-6.1-sol" }
const preferred = { providerID: "ganglia", modelID: "glm-47-flash" }

test("uses the configured summary model before the agent model", async () => {
  const calls = []
  const result = await generateSummary(" ganglia ", " glm-47-flash ", source, async (model) => {
    calls.push(model)
    return "Summary."
  })
  assert.equal(result, "Summary.")
  assert.deepEqual(calls, [preferred])
})

for (const [provider, model] of [[undefined, undefined], ["", ""], ["ganglia", ""]]) {
  test(`uses the agent model when configured values are ${JSON.stringify([provider, model])}`, async () => {
    const calls = []
    await generateSummary(provider, model, source, async (model) => {
      calls.push(model)
      return "Summary."
    })
    assert.deepEqual(calls, [source])
  })
}

test("retries with the agent model when the configured model fails", async () => {
  const calls = []
  const result = await generateSummary("ganglia", "glm-47-flash", source, async (model) => {
    calls.push(model)
    if (calls.length === 1) throw new Error("Unavailable")
    return "Agent summary."
  })
  assert.equal(result, "Agent summary.")
  assert.deepEqual(calls, [preferred, source])
})

test("keeps model IDs that contain slashes", async () => {
  await generateSummary("provider", "namespace/model", source, async (model) => {
    assert.deepEqual(model, { providerID: "provider", modelID: "namespace/model" })
    return "Summary."
  })
})

test("retries with the agent model when the configured model returns empty text", async () => {
  const calls = []
  const result = await generateSummary("ganglia", "glm-47-flash", source, async (model) => {
    calls.push(model)
    return calls.length === 1 ? "  " : "Agent summary."
  })
  assert.equal(result, "Agent summary.")
  assert.deepEqual(calls, [preferred, source])
})

test("does not retry the same model after failure", async () => {
  let calls = 0
  await assert.rejects(generateSummary("ganglia", "gpt-6.1-sol", source, async () => {
    calls++
    throw new Error("Unavailable")
  }), /Unavailable/)
  assert.equal(calls, 1)
})

test("propagates failure when both models fail", async () => {
  const calls = []
  await assert.rejects(generateSummary("ganglia", "glm-47-flash", source, async (model) => {
    calls.push(model)
    throw new Error("Unavailable")
  }), /Unavailable/)
  assert.deepEqual(calls, [preferred, source])
})

test("uses the configured summary model without an agent model", async () => {
  assert.equal(await generateSummary("ganglia", "glm-47-flash", undefined, async () => "Summary."), "Summary.")
})

test("fails without either model", async () => {
  await assert.rejects(generateSummary(undefined, undefined, undefined, async () => {
    assert.fail("Must not generate without a model")
  }), /no model available/)
})
