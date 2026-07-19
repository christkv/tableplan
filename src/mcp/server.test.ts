import { describe, expect, it } from "vitest";

import { API_SCOPES, type ApiAccessContext } from "../auth/api-keys";
import { handleMcpRequest } from "./server";

const access: ApiAccessContext = {
  authType: "api-key",
  userId: "user-test",
  householdId: "household-test",
  scopes: new Set(API_SCOPES),
};

function mcpRequest(method: string, id: number, params: Record<string, unknown> = {}) {
  return new Request("https://tableplan.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
}

describe("MCP access context", () => {
  it("keeps read and write permissions explicit", () => {
    const readOnly: ApiAccessContext = { authType: "api-key", userId: "u", householdId: "h", scopes: new Set(["recipes:read", "plans:read"]) };
    expect(readOnly.scopes.has("recipes:read")).toBe(true);
    expect(readOnly.scopes.has("plans:write")).toBe(false);
    expect(API_SCOPES).toContain("shopping:write");
    expect(API_SCOPES).toContain("recipes:write");
  });

  it("publishes the bounded meal-planning tool catalog over Streamable HTTP", async () => {
    const response = await handleMcpRequest(
      mcpRequest("tools/list", 1),
      { DB: {} as D1Database } as CloudflareEnvironment,
      access,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-expose-headers")).toContain("mcp-protocol-version");

    const payload = await response.json() as { result: { tools: Array<{ name: string; inputSchema?: { properties?: Record<string, unknown> }; annotations?: { readOnlyHint?: boolean } }> } };
    expect(payload.result.tools.map((tool) => tool.name)).toEqual([
      "search_recipes",
      "list_saved_searches",
      "save_recipe_search",
      "delete_saved_search",
      "get_recipe",
      "import_recipe_text",
      "get_recipe_import",
      "publish_recipe_import",
      "get_meal_plan",
      "add_recipe_to_plan",
      "update_meal_plan_servings",
      "copy_previous_meal_plan",
      "generate_shopping_list",
      "get_shopping_list",
      "create_shopping_list_link",
      "revoke_shopping_list_link",
      "email_shopping_list",
    ]);
    expect(payload.result.tools.find((tool) => tool.name === "search_recipes")?.annotations?.readOnlyHint).toBe(true);
    expect(payload.result.tools.find((tool) => tool.name === "search_recipes")?.inputSchema?.properties).toHaveProperty("tags");
    expect(payload.result.tools.find((tool) => tool.name === "search_recipes")?.inputSchema?.properties).toHaveProperty("tagMatch");
    expect(payload.result.tools.find((tool) => tool.name === "search_recipes")?.inputSchema?.properties).toHaveProperty("scope");
    expect(payload.result.tools.find((tool) => tool.name === "get_recipe")?.inputSchema?.properties).toHaveProperty("servings");
    expect(payload.result.tools.find((tool) => tool.name === "import_recipe_text")?.annotations?.readOnlyHint).toBe(false);
    expect(payload.result.tools.find((tool) => tool.name === "get_recipe_import")?.annotations?.readOnlyHint).toBe(true);
    expect(payload.result.tools.find((tool) => tool.name === "save_recipe_search")?.annotations?.readOnlyHint).toBe(false);
    expect(payload.result.tools.find((tool) => tool.name === "add_recipe_to_plan")?.annotations?.readOnlyHint).toBe(false);
    expect(payload.result.tools.find((tool) => tool.name === "update_meal_plan_servings")?.annotations?.readOnlyHint).toBe(false);
    expect(payload.result.tools.find((tool) => tool.name === "copy_previous_meal_plan")?.annotations?.readOnlyHint).toBe(false);
    expect(payload.result.tools.find((tool) => tool.name === "email_shopping_list")?.annotations?.readOnlyHint).toBe(false);
  });
});
