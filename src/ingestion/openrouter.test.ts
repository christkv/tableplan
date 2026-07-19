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

describe("OpenRouter recipe extraction", () => {
  it("configures a selected model, ordered fallbacks, structured output, and private routing", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: "anthropic/claude-sonnet-4",
      choices: [{ message: { content: JSON.stringify(draft) }, finish_reason: "stop" }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

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
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-key");
    expect(headers.get("HTTP-Referer")).toBe("https://tableplan.example.com");
    expect(headers.get("X-OpenRouter-Title")).toBe("Tableplan");
    const body = JSON.parse(String(init?.body));
    expect(body.models).toEqual(["google/gemini-2.5-flash", "anthropic/claude-sonnet-4", "openai/gpt-4.1-mini"]);
    expect(body.provider).toEqual({ require_parameters: true, data_collection: "deny", zdr: true, allow_fallbacks: true });
    expect(body.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect(body.messages[1].content.length).toBeLessThan(80_050);
  });

  it("uses the OpenRouter model field when no fallback is configured", () => {
    const request = buildOpenRouterRecipeRequest({ kind: "text", source: "recipe" }, ["~openai/gpt-latest"]);
    expect(request).toMatchObject({ model: "~openai/gpt-latest" });
    expect(request).not.toHaveProperty("models");
  });

  it("sends a private image directly to a separately selected vision model", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: "google/gemini-2.5-flash",
      choices: [{ message: { content: JSON.stringify(draft) } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    const bytes = new Uint8Array([1, 2, 3]).buffer;

    const result = await extractRecipeWithOpenRouter({
      apiKey: "key",
      model: "google/gemini-2.5-flash",
      fallbackModels: "openai/gpt-4.1-mini",
    }, { kind: "image", bytes, mediaType: "image/png" }, fetchMock);

    expect(result.requestedModel).toBe("google/gemini-2.5-flash");
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
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

  it("rejects malformed structured output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      model: "a/model", choices: [{ message: { content: "not-json" } }],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(extractRecipeWithOpenRouter({ apiKey: "key", model: "a/model" }, { kind: "text", source: "recipe" }, fetchMock))
      .rejects.toThrow("malformed recipe JSON");
  });
});
