import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { assertFallbackBilling } from "../catalogue.ts";
import { ApiError } from "../http.ts";
import type { CatalogueModel } from "../providers/types.ts";

function model(id: string, freeStatus: CatalogueModel["freeStatus"]): CatalogueModel {
  return {
    id,
    name: id,
    provider: "openrouter",
    freeStatus,
    billingNote: "",
    contextLength: null,
    maxOutputTokens: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsTools: false,
    supportsStructuredOutput: false,
    supportsReasoning: false,
    description: "",
    raw: {},
  };
}

Deno.test("a free request never falls back to a paid model", () => {
  const error = assertThrows(
    () => assertFallbackBilling(model("free/one", "free"), model("paid/two", "paid")),
    ApiError,
  );
  assertEquals((error as ApiError).code, "paid_fallback_blocked");
});

Deno.test("a free request never falls back to an account-managed model", () => {
  const error = assertThrows(
    () => assertFallbackBilling(model("free/one", "free"), model("managed/two", "unknown")),
    ApiError,
  );
  assertEquals((error as ApiError).code, "paid_fallback_blocked");
});

Deno.test("a free request may fall back to another free model", () => {
  assertFallbackBilling(model("free/one", "free"), model("free/two", "free"));
});

Deno.test("an explicitly paid primary may fall back to free or paid models", () => {
  assertFallbackBilling(model("paid/one", "paid"), model("free/two", "free"));
  assertFallbackBilling(model("paid/one", "paid"), model("paid/two", "paid"));
});
