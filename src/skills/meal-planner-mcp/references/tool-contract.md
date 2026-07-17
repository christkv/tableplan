# MCP Tool Contract

Endpoint: `<origin>/mcp`, using Streamable HTTP and bearer authentication.

| Tool | Inputs | Scope | Mutates |
| --- | --- | --- | --- |
| `search_recipes` | optional `query`, `ingredient`, exact `tags`, `tagMatch`, `scope`, `limit` | `recipes:read` | No |
| `list_saved_searches` | none | `recipes:read` | No |
| `save_recipe_search` | `name`, optional search filters | `recipes:write` | Yes |
| `delete_saved_search` | `savedSearchId` | `recipes:write` | Yes |
| `get_recipe` | `recipeId`, optional `servings` | `recipes:read` | No |
| `import_recipe_text` | `text`, optional `filename` | `recipes:write` | Yes, creates an unpublished job |
| `get_recipe_import` | `ingestionId` | `recipes:read` | No |
| `publish_recipe_import` | `ingestionId`, optional reviewed fields and visibility | `recipes:write` | Yes, creates a recipe |
| `get_meal_plan` | `week` | `plans:read` | No |
| `add_recipe_to_plan` | `recipeId`, `date`, `slot`, `servings` | `plans:write` | Yes |
| `update_meal_plan_servings` | `itemId`, `servings` | `plans:write` | Yes |
| `copy_previous_meal_plan` | `targetWeek` | `plans:write` | Yes |
| `generate_shopping_list` | `planId`, `week`, optional `measurementSystem` | `shopping:write` | Yes |
| `get_shopping_list` | none | `shopping:read` | No |

Dates use `YYYY-MM-DD`. Recipe IDs must come from search or detail results.
`planId` must come from a plan read or successful add operation. Tool results
include both human-readable content and `structuredContent`; use the structured
data for subsequent calls.

`get_meal_plan` returns ordered household `mealSlots` with stable IDs and
editable labels. Pass one returned ID to `add_recipe_to_plan`; do not assume
breakfast, lunch, dinner, or snack are configured.

When the user requests a different yield, pass `servings` to `get_recipe` and
use its adjusted quantities. Never multiply unresolved raw lines independently.
Changing planned servings refreshes the linked shopping list under the same list
ID and preserves checked items. Shopping-list results identify the source plan
with its name, date range, and meal count.

Recipe publication defaults to `user_private`. Never publish the extraction
without review, and never select `household` visibility without explicit user
confirmation.

API-key authentication supports current local and Claude-style MCP clients.
Production ChatGPT connections require a public HTTPS endpoint and the OAuth
configuration documented in `docs/operations/api-and-integrations.md`.
