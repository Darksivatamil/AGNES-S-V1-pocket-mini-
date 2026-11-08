import { assertEquals } from "jsr:@std/assert@1";
import { openRouterAdapter } from "./openrouter.ts";
import { nvidiaAdapter } from "./nvidia.ts";

function stubFetch(payload: unknown): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    }))) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

Deno.test("OpenRouter marks zero-priced and :free models free", async () => {
  const restore = stubFetch({
    data: [
      {
        id: "vendor/free-model:free",
        name: "Free Model",
        context_length: 32768,
        pricing: { prompt: "0", completion: "0", request: "0" },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: ["response_format", "tools"],
        top_provider: { max_completion_tokens: 4096 },
      },
      {
        id: "vendor/paid-model",
        name: "Paid Model",
        context_length: 128000,
        pricing: { prompt: "0.000001", completion: "0.000002" },
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
        supported_parameters: [],
      },
      {
        id: "openrouter/free",
        name: "Auto Free",
        pricing: { prompt: "0", completion: "0" },
      },
    ],
  });
  try {
    const models = await openRouterAdapter.listModels("test-key");
    assertEquals(models.length, 3);
    assertEquals(models.find((model) => model.id === "vendor/free-model:free")?.freeStatus, "free");
    assertEquals(models.find((model) => model.id === "vendor/paid-model")?.freeStatus, "paid");
    assertEquals(models.find((model) => model.id === "openrouter/free")?.freeStatus, "free");
    const free = models.find((model) => model.id === "vendor/free-model:free");
    assertEquals(free?.supportsStructuredOutput, true);
    assertEquals(free?.supportsTools, true);
    assertEquals(free?.maxOutputTokens, 4096);
  } finally {
    restore();
  }
});

Deno.test("NVIDIA catalogue marks hosted endpoints unknown, not free", async () => {
  const restore = stubFetch({
    data: [
      { id: "meta/llama-3.1-8b-instruct", object: "model", owned_by: "meta" },
      { id: "nvidia/llama-3.1-nemotron", object: "model", owned_by: "nvidia" },
    ],
  });
  try {
    const models = await nvidiaAdapter.listModels("test-key");
    assertEquals(models.length, 2);
    for (const model of models) {
      assertEquals(model.freeStatus, "unknown");
      assertEquals(model.billingNote.includes("account-managed"), true);
    }
  } finally {
    restore();
  }
});
