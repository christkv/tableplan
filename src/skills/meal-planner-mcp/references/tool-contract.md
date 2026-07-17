# MCP Tool Contract

Endpoint: `<origin>/mcp`, using Streamable HTTP and bearer authentication.

| Tool | Inputs | Scope | Mutates |
| --- | --- | --- | --- |
| `search_recipes` | optional `query`, `ingredient`, exact `tags`, `tagMatch`, `limit` | `recipes:read` | No |
| `list_saved_searches` | none | `recipes:read` | No |
| `save_recipe_search` | `name`, optional search filters | `recipes:write` | Yes |
| `delete_saved_search` | `savedSearchId` | `recipes:write` | Yes |
| `get_recipe` | `recipeId` | `recipes:read` | No |
| `get_meal_plan` | `week` | `plans:read` | No |
| `add_recipe_to_plan` | `recipeId`, `date`, `slot`, `servings` | `plans:write` | Yes |
| `copy_previous_meal_plan` | `targetWeek` | `plans:write` | Yes |
| `generate_shopping_list` | `planId`, `week`, optional `measurementSystem` | `shopping:write` | Yes |
| `get_shopping_list` | none | `shopping:read` | No |

Dates use `YYYY-MM-DD`. Recipe IDs must come from search or detail results.
`planId` must come from a plan read or successful add operation. Tool results
include both human-readable content and `structuredContent`; use the structured
data for subsequent calls.

API-key authentication supports current local and Claude-style MCP clients.
Production ChatGPT connections require a public HTTPS endpoint and the OAuth
configuration documented in `docs/operations/api-and-integrations.md`.
