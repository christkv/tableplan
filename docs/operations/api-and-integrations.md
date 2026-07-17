# API and Assistant Integrations

## API Overview

The REST base path is `/api/v1`. The machine-readable OpenAPI 3.1 document is
available at `/api/v1/openapi.json` and the unauthenticated health endpoint is
`/api/v1/health`.

Authenticated endpoints accept either the signed browser session cookie or an
API key in the bearer header:

```http
Authorization: Bearer mp_test_REDACTED
```

Create API keys from **Settings > API access**. The complete key is displayed
once; only its hash and a non-secret prefix are stored. Use test keys locally
and preview, live keys in production, short expirations where practical, and
only the required scopes.

| Scope | Allows |
| --- | --- |
| `recipes:read` | Recipe, tag-filter, and saved-search reads |
| `recipes:write` | Create, replace, and delete household saved searches |
| `plans:read` | Weekly plan reads |
| `plans:write` | Add recipes to a weekly plan |
| `shopping:read` | Read the latest shopping-list snapshot |
| `shopping:write` | Generate a shopping-list snapshot |
| `household:read` | Reserved household profile access |
| `admin:import` | Reserved import administration |

## REST Examples

Keep secrets in environment variables and prevent shell history or process logs
from capturing them.

```bash
export TABLEPLAN_URL=http://localhost:5173
export TABLEPLAN_API_KEY=mp_test_REDACTED

curl -sS "$TABLEPLAN_URL/api/v1/recipes/search?q=chickpea&tag=main-dish&tag=healthy&tagMatch=all&limit=5" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY"

curl -sS "$TABLEPLAN_URL/api/v1/meal-plans?week=2026-07-13" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY"
```

Repeat `tag` to select multiple exact tags. `tagMatch=all` is the default and
requires every selected tag; `tagMatch=any` requires at least one. Text,
ingredient, and tag filters are combined with AND.

Save a reusable household search, list saved searches, and delete one by its
returned ID:

```bash
curl -sS -X POST "$TABLEPLAN_URL/api/v1/saved-searches" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"Fast healthy dinners","query":"quick","tags":["main-dish","healthy"],"tagMatch":"all"}'

curl -sS "$TABLEPLAN_URL/api/v1/saved-searches" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY"

curl -sS -X DELETE "$TABLEPLAN_URL/api/v1/saved-searches/SAVED_SEARCH_ID" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY"
```

Add a selected recipe only after resolving its stable ID:

```bash
curl -sS -X POST "$TABLEPLAN_URL/api/v1/meal-plans" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "week": "2026-07-13",
    "recipeId": "recipe_224818",
    "date": "2026-07-16",
    "slot": "dinner",
    "servings": 6
  }'
```

Clone the previous week into an empty target week. This returns `409` rather
than merging when the target already has meals:

```bash
curl -sS -X POST "$TABLEPLAN_URL/api/v1/meal-plans/clone-previous" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"targetWeek":"2026-07-20"}'
```

Generate a combined list with the returned plan ID:

```bash
curl -sS -X POST "$TABLEPLAN_URL/api/v1/shopping-lists/generate" \
  -H "Authorization: Bearer $TABLEPLAN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "planId": "PLAN_ID",
    "week": "2026-07-13",
    "measurementSystem": "metric"
  }'
```

Errors are JSON objects containing `code` and `message`. `401` means the
credential is missing, invalid, expired, or revoked. `403` means its scopes are
insufficient. Revoke a compromised key immediately from Settings.

## MCP Endpoint

The Streamable HTTP endpoint is `/mcp`. It publishes ten bounded tools:

| Tool | Required scope | Behavior |
| --- | --- | --- |
| `search_recipes` | `recipes:read` | Search recipes and return stable IDs |
| `list_saved_searches` | `recipes:read` | Read reusable household recipe filters |
| `save_recipe_search` | `recipes:write` | Create or replace a named household search |
| `delete_saved_search` | `recipes:write` | Delete one saved search by ID |
| `get_recipe` | `recipes:read` | Read ingredients, steps, and parse quality |
| `get_meal_plan` | `plans:read` | Read one household ISO week |
| `add_recipe_to_plan` | `plans:write` | Add a selected recipe, date, slot, and servings |
| `copy_previous_meal_plan` | `plans:write` | Copy the previous week into an empty target week |
| `generate_shopping_list` | `shopping:write` | Create a combined list snapshot |
| `get_shopping_list` | `shopping:read` | Read the household's latest list |

The server returns concise text plus structured content and marks read versus
write tools with MCP annotations.

## Claude Code

Claude Code can connect directly with a scoped API key:

```bash
claude mcp add --transport http tableplan "$TABLEPLAN_URL/mcp" \
  --header "Authorization: Bearer $TABLEPLAN_API_KEY"
claude mcp get tableplan
```

Use local scope for personal credentials. A checked-in `.mcp.json` must use
environment-variable expansion and must never contain a literal key. Current
Claude Code documentation recommends HTTP for remote MCP and supports bearer
headers for this transport.

## ChatGPT

ChatGPT cannot send a custom Tableplan API key to an MCP connector. A production
connection therefore requires all of the following before it is enabled:

1. Deploy `/mcp` at a public HTTPS origin.
2. Integrate an established OAuth 2.1 authorization provider that supports the
   MCP authorization requirements and PKCE.
3. Publish RFC 9728 protected-resource metadata and authorization-server or
   OpenID discovery metadata.
4. Include the exact resource/audience and Tableplan scopes in issued tokens.
5. Verify token signature, issuer, audience/resource, expiry, and scopes at the
   Worker before resolving the household.
6. Advertise per-tool OAuth security schemes and return a discoverable
   `WWW-Authenticate` challenge on `401` responses.
7. Test the complete flow in preview before adding the connector in ChatGPT.

This OAuth resource-server work is deliberately not represented as complete in
`docs/implementation-progress.md`. Static API-key MCP access is suitable for
local integration and Claude Code, but it is not a substitute for ChatGPT user
authorization.

## Repository Skills

The skills under `src/skills/` provide safe operating guidance for REST, MCP,
and imports. They contain no deployment URL or secret. Install or package them
for a chosen assistant only after reviewing their `SKILL.md` and references.

## Sources for Client Requirements

- [Anthropic Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)
- [OpenAI Apps SDK authentication](https://developers.openai.com/apps-sdk/build/auth)
- [OpenAI MCP server concepts](https://developers.openai.com/apps-sdk/concepts/mcp-server)
