import { describe, expect, it, vi } from "vitest";

import {
  buildOpenRouterRecipeRequest,
  extractRecipeWithOpenRouter,
  normalizeOpenRouterBaseUrl,
  OpenRouterRecipeError,
  parseOpenRouterModels,
} from "./openrouter";

const draft = {
  title: " Tomato Soup ",
  description: "Simple soup",
  servings: 4,
  servingSize: null,
  ingredients: [" 2 tomatoes ", "2 tomatoes", "1 cup stock"],
  steps: ["Simmer."],
  tags: [" Quick Meal "],
  warnings: [],
};

function chatCompletion(model: string, content: string) {
  return {
    id: "generation_test",
    created: 1_721_000_000,
    model,
    object: "chat.completion",
    system_fingerprint: null,
    choices: [{
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content, refusal: null },
    }],
  };
}

interface CapturedOpenRouterRequest {
  model?: string;
  models?: string[];
  provider: Record<string, unknown>;
  response_format: { json_schema: { strict: boolean } };
  messages: Array<{ content: unknown }>;
}

describe("OpenRouter recipe extraction", () => {
  it("configures a selected model, ordered fallbacks, structured output, and private routing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(
      chatCompletion("anthropic/claude-sonnet-4", JSON.stringify(draft)),
    ), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await extractRecipeWithOpenRouter({
      apiKey: "secret-key",
      model: "google/gemini-2.5-flash",
      fallbackModels: "anthropic/claude-sonnet-4, openai/gpt-4.1-mini",
      appUrl: "https://tableplan.example.com",
      appTitle: "Tableplan",
    }, { kind: "text", source: "A".repeat(81_000) }, fetchMock);

    expect(result.requestedModel).toBe("google/gemini-2.5-flash");
    expect(result.resolvedModel).toBe("anthropic/claude-sonnet-4");
    expect(result.draft).toMatchObject({ title: "Tomato Soup", ingredients: ["2 tomatoes", "1 cup stock"], tags: ["quick-meal"] });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.contexts[0]).toBe(globalThis);
    const request = fetchMock.mock.calls[0][0] as Request;
    expect(request.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = request.headers;
    expect(headers.get("Authorization")).toBe("Bearer secret-key");
    expect(headers.get("HTTP-Referer")).toBe("https://tableplan.example.com");
    expect(headers.get("X-OpenRouter-Title")).toBe("Tableplan");
    const body = await request.clone().json() as CapturedOpenRouterRequest;
    expect(body.models).toEqual(["google/gemini-2.5-flash", "anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"]);
    expect(body.provider).toEqual({ require_parameters: true, data_collection: "deny", zdr: true, allow_fallbacks: true });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(String(body.messages[1].content).length).toBeLessThan(80_050);
  });

  it("uses the OpenRouter model field when no fallback is configured", () => {
    const request = buildOpenRouterRecipeRequest({ kind: "text", source: "recipe" }, ["~openai/gpt-latest"]);
    expect(request).toMatchObject({ model: "~openai/gpt-latest" });
    expect(request).not.toHaveProperty("models");
  });

  it("sends a private image directly to a separately selected vision model", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(
      chatCompletion("google/gemini-2.5-flash", JSON.stringify(draft)),
    ), { status: 200, headers: { "Content-Type": "application/json" } }));
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    const result = await extractRecipeWithOpenRouter({
      apiKey: "key",
      model: "google/gemini-2.5-flash",
      fallbackModels: "openai/gpt-4.1-mini",
    }, { kind: "image", bytes, mediaType: "image/png" }, fetchMock);

    expect(result.requestedModel).toBe("google/gemini-2.5-flash");
    const body = await (fetchMock.mock.calls[0][0] as Request).clone().json() as CapturedOpenRouterRequest;
    expect(body.models).toEqual(["google/gemini-2.5-flash", "openai/gpt-4.1-mini"]);
    expect(body.messages[1].content).toEqual([
      { type: "text", text: "Read the recipe in this private image and extract its structured fields." },
      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
    ]);
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("rejects unsupported or empty vision inputs before making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, {
      kind: "image", bytes: new ArrayBuffer(0), mediaType: "image/png",
    }, fetchMock)).rejects.toThrow("between 1 byte and 12 MiB");
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, {
      kind: "image", bytes: new Uint8Array([1]).buffer, mediaType: "image/svg+xml",
    }, fetchMock)).rejects.toThrow("supported recipe image");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("deduplicates models and limits the fallback list", () => {
    expect(parseOpenRouterModels("google/gemini-2.5-flash", "google/gemini-2.5-flash, openai/gpt-4.1-mini"))
      .toEqual(["google/gemini-2.5-flash", "openai/gpt-4.1-mini"]);
    expect(() => parseOpenRouterModels("a/model", "b/model,c/model,d/model,e/model"))
      .toThrow("At most 3 OpenRouter fallback models");
    expect(() => parseOpenRouterModels("not a model")).toThrow("valid model slugs");
  });

  it("accepts official OpenRouter endpoints and rejects credential exfiltration hosts", () => {
    expect(normalizeOpenRouterBaseUrl()).toBe("https://openrouter.ai/api/v1");
    expect(normalizeOpenRouterBaseUrl("https://eu.openrouter.ai/api/v1/")).toBe("https://eu.openrouter.ai/api/v1");
    expect(() => normalizeOpenRouterBaseUrl("https://example.com/api/v1")).toThrow("OpenRouter HTTPS endpoint");
    expect(() => normalizeOpenRouterBaseUrl("http://openrouter.ai/api/v1")).toThrow("OpenRouter HTTPS endpoint");
  });

  it("returns bounded provider errors without exposing response content", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 429, message: "sensitive provider detail" },
    }), { status: 429, headers: { "Content-Type": "application/json" } }));
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, { kind: "text", source: "private source" }, fetchMock))
      .rejects.toEqual(expect.objectContaining<Partial<OpenRouterRecipeError>>({ message: "OpenRouter extraction failed (429)", status: 429 }));
  });

  it("explains endpoint and privacy incompatibility for OpenRouter 404 responses", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 404, message: "No endpoints found that support the requested data policy" },
    }), { status: 404, headers: { "Content-Type": "application/json" } }));
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, { kind: "text", source: "private source" }, fetchMock))
      .rejects.toEqual(expect.objectContaining<Partial<OpenRouterRecipeError>>({
        message: "OpenRouter found no endpoint matching the selected model and required private-data routing (404)",
        status: 404,
      }));
  });

  it("redacts SDK transport diagnostics", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new TypeError(
      "Illegal invocation for https://openrouter.ai/api/v1/chat/completions using sk-or-v1-sensitive",
    ));
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, { kind: "text", source: "private source" }, fetchMock))
      .rejects.toEqual(expect.objectContaining<Partial<OpenRouterRecipeError>>({
        message: "OpenRouter SDK could not complete recipe extraction (UnexpectedClientError / TypeError: Illegal invocation for [url] using [redacted])",
      }));
  });

  it("rejects malformed structured output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(
      chatCompletion("a/model", "not-json"),
    ), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, { kind: "text", source: "recipe" }, fetchMock))
      .rejects.toThrow("malformed recipe JSON");
  });
});
