# Phase 7: MCP Server

## Objective

Expose meal-planner capabilities as a remote Model Context Protocol server for Claude, ChatGPT developer testing, and other MCP clients while preserving the API's authorization and domain rules.

## Dependencies

- Phase 6 REST schemas, API scopes, and domain services.
- A reachable HTTPS preview deployment for remote-client testing.

## Deliverables

- Streamable HTTP MCP endpoint at `/mcp` in the existing Worker deployment.
- API-key bearer authentication for local development and server-to-server clients.
- OAuth 2.1 protected-resource integration for user-facing remote clients.
- Tool registry with structured schemas, annotations, bounded outputs, and consistent errors.
- Local MCP Inspector workflow and connection documentation.
- Audit linkage from MCP calls to user/key, household, tool, request ID, and mutation result.

## Initial Tools

```text
search_recipes
get_recipe
get_recipe_ingredients
find_ingredient
list_favorites
add_favorite
create_meal_plan
get_meal_plan
add_recipe_to_plan
generate_shopping_list
get_shopping_list
update_shopping_item
```

## Tool Design Rules

- Tool handlers call domain services directly through the same application layer as REST and UI.
- Read tools are annotated read-only; mutations clearly describe side effects and required scopes.
- Inputs use stable IDs and explicit dates, servings, limits, and household context where needed.
- Outputs prefer concise `structuredContent`; natural-language content stays short.
- Recipe steps are summarized or omitted unless specifically requested.
- Search and list tools enforce pagination and hard result limits.
- Mutation responses return the changed resource and enough context to review the action.
- Bulk or replacement operations use preview/confirm semantics where supported.

## Authentication Stages

### API-Key Preview

Local and Claude Code development can send:

```text
Authorization: Bearer mp_test_...
```

### OAuth Preview

Before user-facing ChatGPT or Claude distribution, implement protected-resource metadata, authorization-server metadata, PKCE, redirect URI validation, consent, token expiry/revocation, and mapping from OAuth scopes to application scopes.

## Implementation Sequence

1. Add MCP transport and lifecycle handling to the Worker.
2. Map API-key auth context and scopes to MCP calls.
3. Implement read-only recipe tools and verify with MCP Inspector.
4. Add favorites, planning, and shopping mutations.
5. Add OAuth resource metadata and authorization flow.
6. Add structured logs, audit events, limits, and error sanitization.
7. Test local, preview, and remote-client connection paths.

## Verification

- Protocol conformance and MCP Inspector tests.
- Schema tests for every tool input and structured output.
- Tool-to-service parity tests against corresponding REST operations.
- Scope, household isolation, expired credential, and revoked credential tests.
- Remote HTTPS smoke test from at least one Claude client and ChatGPT developer mode.
- Context-size tests for broad searches and long recipes.

## Acceptance Criteria

- MCP clients can discover the tool list and call read tools locally and in preview.
- API-key clients can perform only actions allowed by their scopes.
- OAuth-authenticated users are mapped to the correct account and household.
- Read and mutation tool annotations accurately represent side effects.
- No tool can bypass household checks enforced by the underlying services.
- Tool responses stay within documented result and payload limits.

## Non-Goals

- Rich assistant-specific UI components; Phase 8 owns those.
- Portable skill packaging; Phase 9 owns it.
- Semantic search mode; Phase 10 adds it to the existing search tool.

## Exit Artifact

A secure remote tool server that can be exercised by Claude and ChatGPT and reused by later assistant experiences.
