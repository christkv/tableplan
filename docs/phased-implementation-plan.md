# Phased Implementation Plan

Date: 2026-07-16

This plan turns the product plan into an implementation sequence. The priority is to make the app fast to iterate locally, deploy cleanly to Cloudflare, and expose the same core capabilities through UI, API, MCP, and Agent Skills.

Detailed delivery briefs live in [`docs/phases`](phases/README.md). Those documents are canonical for phase scope, dependencies, verification, and acceptance criteria; this document remains the condensed cross-phase roadmap.

## Review Decisions

- Use one phase sequence numbered 0 through 12 across all planning documents.
- Import a deterministic sample in Phase 2; defer the full preview/production catalog load to Phase 11 after schema and contracts stabilize.
- Include favorites in Phase 3 so recipe discovery has a complete save workflow.
- Complete the quantity engine before shopping-list generation.
- Stabilize the REST/OpenAPI contract before MCP, assistant UX, and Agent Skills.
- Treat API keys as developer/server credentials and require OAuth for production user-facing assistant connections.
- Keep FTS as the always-available search baseline; Vectorize augments it in Phase 10.

## Implementation Principles

- One domain layer, multiple surfaces: UI routes, REST API, MCP tools, and import jobs should call the same application services.
- Local-first iteration: every feature must run against local D1/SQLite-compatible storage before relying on Cloudflare services.
- Cloudflare-native production: Workers, D1, Vectorize, Workers AI, Queues, and optional R2.
- Data import is a product feature: import runs, parse quality, and data coverage must be inspectable.
- Agent integrations are first-class: expose stable IDs, structured outputs, scoped auth, and read/write approval boundaries.

## Target Repository Shape

```text
app/
  routes/                  React Router routes and API route handlers
  components/              shadcn/ui app components
  features/                UI feature modules
  lib/                     shared client/server helpers
workers/
  app.ts                   Cloudflare Worker entrypoint
src/
  domain/                  recipe, planning, shopping, unit services
  db/                      schema, repositories, migrations helpers
  auth/                    Better Auth integration and authorization guards
  api/                     REST handlers, OpenAPI generation, API-key auth
  mcp/                     Streamable HTTP MCP server and tool registry
  import/                  import parser, staging, export, QA pipeline
  search/                  FTS, Vectorize, ranking
  skills/                  generated Agent Skill source bundles
migrations/
scripts/
  import-recipes.ts
  dev-seed.ts
  generate-openapi.ts
  generate-skills.ts
data/
docs/
```

## Local and Cloudflare Runtime Strategy

Local modes:

- `npm run dev`: run the React Router Cloudflare Vite dev server with local bindings.
- `npm run db:migrate:local`: apply D1 migrations locally.
- `npm run import:sample`: import a small deterministic sample from the CSV for UI work.
- `npm run import:local`: run the full import into a local SQLite/D1-compatible staging database.
- `npm run mcp:local`: expose the local MCP server over HTTP for Claude Code or ChatGPT developer testing.

Cloudflare modes:

- Preview deploy uses preview D1, preview Vectorize index, and test OAuth/API keys.
- Production deploy uses production D1, Vectorize, Workers AI, Queues, and optional R2.
- Heavy data loading is staged locally and uploaded in SQL chunks rather than streaming the 793 MB CSV through Worker requests.
- Vector embedding and re-index work can run through a Cloudflare Queue after relational import.

Configuration:

- Use `wrangler.jsonc` environments: `local`, `preview`, `production`.
- Keep all resource names environment-specific.
- Use `.dev.vars` for local secrets and `wrangler secret put` for Cloudflare secrets.
- Do not commit generated local DBs, SQL chunks, embedding dumps, or API keys.

## [Phase 0: Project Bootstrap](phases/phase-00-project-bootstrap.md)

Deliverables:

- Scaffold React Router full-stack app for Cloudflare Workers.
- Add TypeScript, Tailwind, shadcn/ui, linting, formatting, Vitest.
- Add `wrangler.jsonc` with D1, AI, Vectorize, Queue, and optional R2 placeholders.
- Add base routing: app shell, sign-in placeholder, recipe search placeholder.
- Add architecture decision records for local/Cloudflare parity and agent surfaces.

Acceptance:

- `npm run dev` starts locally.
- `npm run build` passes.
- One placeholder route can read from a local binding.

## [Phase 1: Schema, Auth, and Authorization](phases/phase-01-schema-auth-authorization.md)

Deliverables:

- D1 migrations for app tables:
  - households, household_members, user_profiles, preferences.
  - recipes, ingredients, recipe_ingredients, tags, search tables.
  - meal_plans, meal_plan_items, shopping_lists, shopping_list_items.
  - api_keys, api_key_events, api_rate_limits.
  - import_runs, import_issues, import_metrics.
- Better Auth configured with:
  - Google OAuth.
  - Email/password.
  - Username plugin.
  - D1 database binding.
- Household creation on first sign-in.
- Server authorization helpers:
  - `requireUser`.
  - `requireHouseholdMember`.
  - `requireHouseholdRole`.
  - `requireApiScope`.

Acceptance:

- User can sign in locally with dev auth or local Better Auth config.
- API route can distinguish session auth from API-key auth.
- Household access checks are covered by tests.

## [Phase 2: Import Tool MVP](phases/phase-02-import-tool-mvp.md)

Build an import tool before building broad UI, because the UI quality depends on realistic data.

CLI commands:

```bash
npm run import -- analyze data/recipes_ingredients.csv
npm run import -- sample data/recipes_ingredients.csv --rows 5000 --out .import/sample.sqlite
npm run import -- stage data/recipes_ingredients.csv --out .import/stage.sqlite
npm run import -- normalize .import/stage.sqlite
npm run import -- qa .import/stage.sqlite --out .import/reports
npm run import -- export-sql .import/stage.sqlite --out .import/sql
npm run import -- apply-local .import/sql
npm run import -- apply-remote .import/sql --env preview
```

Import modules:

- CSV stream reader.
- Strict JSON list parser.
- Tolerant fallback parser for malformed `steps`.
- Raw ingredient parser.
- Unit and quantity normalizer.
- Ingredient canonicalizer.
- Tag normalizer.
- FTS builder.
- QA reporter.
- SQL chunk exporter for D1.

Import run tracking:

- `import_runs`: source file hash, row counts, status, timings, tool version.
- `import_issues`: row id, field, severity, reason, raw value excerpt.
- `import_metrics`: parse coverage, unit coverage, serving outliers, row counts.

Sample strategy:

- Deterministic samples by source id hash.
- Special fixture sets:
  - malformed steps.
  - package sizes.
  - ranges.
  - no quantity.
  - very large servings.
  - common family dinners.

Acceptance:

- `import:sample` completes in under a few minutes.
- QA report clearly shows parse coverage and top unresolved units.
- Imported sample powers recipe search and detail pages locally.

## [Phase 3: Recipe Browser, Search, and Favorites](phases/phase-03-recipe-browser-search.md)

Deliverables:

- Recipe search page using sample import.
- Recipe detail page with:
  - raw ingredient lines.
  - parsed/scaled ingredient lines.
  - steps.
  - tags.
  - parse quality indicators.
- D1 FTS5 keyword search.
- Ingredient/tag filters.
- Shared `RecipeSearchService` used by UI, REST, and MCP.

Acceptance:

- Search works locally without Vectorize.
- Detail pages are stable for malformed/partially parsed recipes.
- API and UI return the same recipe IDs for the same filters.

## [Phase 4: Units and Shopping Quantity Engine](phases/phase-04-units-quantity-engine.md)

Deliverables:

- Unit registry:
  - mass, volume, count, package, temperature.
  - US and metric display formats.
  - aliases from the dataset.
- Quantity parser and formatter.
- Scaling by recipe servings.
- Aggregation engine:
  - merge compatible mass units.
  - merge compatible volume units.
  - keep package/count units separate when not safely convertible.
  - preserve unresolved lines.
- Tests for conversion, ranges, package sizes, and unresolved quantities.

Acceptance:

- Scaling a recipe from 4 to 6 servings changes every parsed ingredient correctly.
- Shopping aggregation never silently converts volume to mass without density.
- Unresolved ingredients remain visible with source recipe references.

## [Phase 5: Meal Planning and Shopping Lists](phases/phase-05-meal-planning-shopping-lists.md)

Deliverables:

- Weekly meal planner.
- Add recipe to date/slot.
- Per-plan-item servings override.
- Generate shopping list from selected date range.
- Check off shopping items.
- Manual additions.
- Household sharing.
- REST endpoints and MCP tools for planning and shopping.

Acceptance:

- A user can search recipes, plan a week, and generate one combined shopping list.
- Shopping list output is deterministic and covered by tests.
- API clients can create/read/update plans using scoped API keys.

## [Phase 6: REST API, API Keys, and OpenAPI](phases/phase-06-rest-api-keys-openapi.md)

API goals:

- Same business capabilities as the UI.
- Stable resource IDs and structured JSON.
- Safe defaults for agent use.
- Scoped API keys for external clients.

API auth:

- Browser/session auth for UI.
- API key auth for external clients:
  - Prefix format: `mp_live_...`, `mp_test_...`.
  - Store only hashed key material.
  - Show full key only once at creation.
  - Scopes: `recipes:read`, `plans:read`, `plans:write`, `shopping:read`, `shopping:write`, `household:read`, `admin:import`.
  - Optional household binding per key.
  - Expiration and revocation.
  - Last-used timestamp and audit log.

Core endpoints:

```text
GET    /api/v1/health
GET    /api/v1/openapi.json
GET    /api/v1/recipes/search
GET    /api/v1/recipes/:id
GET    /api/v1/ingredients/search
GET    /api/v1/tags
GET    /api/v1/favorites
POST   /api/v1/favorites
DELETE /api/v1/favorites/:recipeId
GET    /api/v1/meal-plans
POST   /api/v1/meal-plans
GET    /api/v1/meal-plans/:id
POST   /api/v1/meal-plans/:id/items
PATCH  /api/v1/meal-plans/:id/items/:itemId
DELETE /api/v1/meal-plans/:id/items/:itemId
POST   /api/v1/shopping-lists/generate
GET    /api/v1/shopping-lists/:id
PATCH  /api/v1/shopping-lists/:id/items/:itemId
POST   /api/v1/api-keys
GET    /api/v1/api-keys
DELETE /api/v1/api-keys/:id
```

OpenAPI:

- Generate `openapi.json` from route schemas.
- Include API-key security scheme.
- Include examples optimized for agents.
- Publish local and production server URLs.

Acceptance:

- External `curl` with API key can search recipes and generate a shopping list.
- OpenAPI validates in CI.
- API-key scope tests cover forbidden writes and cross-household access.

## [Phase 7: MCP Server for ChatGPT, Claude, and Claude Code](phases/phase-07-mcp-server.md)

Build a Streamable HTTP MCP server backed by the REST/domain services.

Why MCP:

- OpenAI documents remote MCP servers as a way to give models access to external services through the Responses API.
- ChatGPT Apps SDK uses MCP as the backbone for tools and UI.
- Claude Code supports remote HTTP MCP servers and bearer-token headers.

Transport:

- Production: `https://app.example.com/mcp`.
- Local: `http://127.0.0.1:8787/mcp` for Claude Code, plus tunnel for ChatGPT developer-mode testing.
- Prefer Streamable HTTP. Avoid SSE except for compatibility.

Authentication:

- Phase 7a: API-key bearer auth for development and Claude Code:
  - `Authorization: Bearer mp_test_...`
- Phase 7b: OAuth 2.1 for ChatGPT Apps and user-specific remote MCP:
  - protected resource metadata.
  - OAuth metadata.
  - PKCE flow.
  - scopes mapped to API scopes.
- Keep API keys for server-to-server and local developer workflows.

Initial MCP tools:

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

Tool design rules:

- Read tools get `readOnlyHint: true`.
- Mutating tools get explicit destructive/open-world annotations where appropriate.
- Return concise `structuredContent` with IDs, names, quantities, units, and source references.
- Keep natural-language `content` short.
- Do not return entire long recipe steps unless requested.
- Include pagination and result limits.
- Every tool has matching REST endpoint coverage.

Acceptance:

- MCP Inspector can list and call tools locally.
- Claude Code can connect with:

```bash
claude mcp add --transport http meal-planner http://127.0.0.1:8787/mcp \
  --header "Authorization: Bearer mp_test_xxx"
```

- ChatGPT developer-mode app can reach the MCP server via HTTPS tunnel or preview URL.

## [Phase 8: ChatGPT App and Claude Connector UX](phases/phase-08-chatgpt-claude-ux.md)

ChatGPT app:

- Apps SDK app published as a plugin when ready.
- Tool-linked UI components for:
  - recipe search results.
  - recipe detail.
  - week plan.
  - shopping list.
- Developer-mode testing first.
- Use OAuth 2.1 before production distribution.

Claude:

- Remote MCP connector documented for Claude Code.
- Optional Claude Desktop/claude.ai connector instructions when account/workspace supports it.
- Start with API-key auth for local development, OAuth for broader user auth.

Acceptance:

- From ChatGPT: "Find five vegetarian dinners with chickpeas and add two to next week" can call search and plan tools.
- From Claude Code: "Generate a shopping list for next week" can call MCP tools and return structured items.

## [Phase 9: Agent Skills](phases/phase-09-agent-skills.md)

Create portable Agent Skills that teach assistants how to use the API/MCP safely.

Skill packages:

1. `meal-planner-api`
   - When to use: direct REST API access.
   - Includes OpenAPI URL, auth header rules, common workflows, and examples.
   - Includes optional helper script for signed API calls.
2. `meal-planner-mcp`
   - When to use: connected MCP server is available.
   - Describes tool semantics and safe workflow order.
   - Emphasizes search before planning and review before shopping-list generation.
3. `meal-planner-import-admin`
   - Internal/admin only.
   - Documents import commands, QA thresholds, and rollback rules.

Packaging:

- Maintain canonical sources under `src/skills/<name>/SKILL.md`.
- Generate:
  - OpenAI-compatible zip for API Skills.
  - Claude Code project skill under `.claude/skills/<name>/SKILL.md`.
  - Optional Claude custom skill zip if needed.
- Keep each skill focused and concise.

Acceptance:

- Skills include examples for:
  - recipe search.
  - create weekly plan.
  - generate shopping list.
  - read-only dataset research.
- Skills never embed real API keys.
- Skills reference local, preview, and production base URL placeholders.

## [Phase 10: Vector Search and Semantic Data Source](phases/phase-10-vector-hybrid-search.md)

Deliverables:

- Workers AI embedding generation job.
- Vectorize upsert pipeline.
- Hybrid ranker.
- API/MCP semantic search option:

```text
GET /api/v1/recipes/search?q=quick kid friendly tofu dinners&mode=hybrid
```

- Data-source/export endpoints:
  - compact recipe document JSON.
  - embedding text preview.
  - recipe citations and source IDs.
  - household-scoped meal plan context.

Acceptance:

- Vector search is optional in local mode.
- FTS-only fallback is automatic when Vectorize is unavailable.
- Semantic search results include enough source metadata for ChatGPT/Claude citations.

## [Phase 11: Full Import, Preview, and Production](phases/phase-11-full-import-production.md)

Deliverables:

- Full local import.
- Full QA report.
- Preview D1 import.
- Preview Vectorize index.
- Production import runbook.
- Rollback/export strategy.

Production import sequence:

1. Freeze migrations.
2. Run full local import.
3. Review QA thresholds.
4. Export D1 SQL chunks.
5. Apply to preview.
6. Smoke test UI/API/MCP.
7. Apply to production.
8. Run embedding queue.
9. Publish import report.

Acceptance:

- Production can search full recipe catalog.
- Import run is reproducible from source file hash.
- API and MCP tools work against production with test keys.

## [Phase 12: Hardening and Operations](phases/phase-12-hardening-operations.md)

Security:

- API-key hashing and rotation.
- Rate limits per key and per user.
- Audit logs for writes.
- Household authorization tests.
- CORS allowlist.
- Request validation everywhere.
- Explicit admin-only import endpoints.

Reliability:

- D1 query performance checks.
- Vectorize failure fallback.
- Queue retry and dead-letter reporting.
- Import idempotency.
- Observability dashboard.

Agent safety:

- Read-only tools by default.
- Mutating MCP tools require scopes and clear tool annotations.
- Shopping-list and meal-plan mutations return previews before bulk changes where possible.
- Max result limits to avoid flooding model context.

## [Phase 13: Private Recipe Ingestion](phases/phase-13-private-recipe-ingestion.md)

Deliverables:

- User-private and explicitly household-shared recipe ownership.
- Paste, document-upload, and image-upload creation paths.
- Private R2 source artifacts with retention and authenticated preview.
- Per-ingestion Cloudflare Agent with a durable AgentWorkflow.
- Workers AI document/image conversion and JSON-schema recipe extraction.
- Human review and approval before relational publishing.
- Canonical ingredient lookup, conservative mapping, and household aliases.
- Search, detail, favorites, planning, shopping, REST, and MCP authorization.

Build order:

1. Ownership and manual private recipes.
2. Artifacts, jobs, drafts, and status transitions.
3. Agent and Workflow extraction with local mocks.
4. Ingredient mapping review and idempotent publish.
5. API/MCP contracts and privacy-aware indexing.
6. Preview security, retention, cost, and recovery gate.

Acceptance:

- Model output is always reviewed before publish.
- Unknown ingredients remain visible and do not pollute the global vocabulary.
- Private recipes and artifacts are non-discoverable across users/households.
- Retry and duplicate approval create exactly one recipe.
- Local development does not require cloud AI credentials.

## Recommended Build Order

1. Bootstrap app and local D1.
2. Auth and household authorization.
3. Import sample tool.
4. Recipe browser.
5. Unit scaling and shopping aggregation tests.
6. Meal planner and shopping list.
7. REST API and API keys.
8. MCP read-only tools.
9. MCP write tools.
10. Agent Skills.
11. Vector search.
12. Full import and production hardening.
13. Private recipe ingestion can proceed after its ownership migration and may
    run in parallel with blocked Phase 10 cloud provisioning.

## Open Questions

- Which email provider should handle verification and password reset?
- Should public recipe search be allowed without login, or is every API call authenticated?
- Do we need multiple households per user in MVP?
- Should API keys be personal, household-owned, or both?
- Should ChatGPT production distribution be a private/internal plugin first?
- Do we need nutrition enrichment in MVP, or only meal planning and shopping quantities?

## References

- Product plan: `docs/meal-planner-application-plan.md`
- Detailed phase index: `docs/phases/README.md`
- Cloudflare D1 limits and import notes: https://developers.cloudflare.com/d1/platform/limits/ and https://developers.cloudflare.com/d1/best-practices/import-export-data/
- Cloudflare React Router guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/
- OpenAI MCP and Connectors: https://developers.openai.com/api/docs/guides/tools-connectors-mcp
- OpenAI Apps SDK MCP server guide: https://developers.openai.com/apps-sdk/concepts/mcp-server
- OpenAI Apps SDK authentication: https://developers.openai.com/apps-sdk/build/auth
- OpenAI Apps SDK ChatGPT connection: https://developers.openai.com/apps-sdk/deploy/connect-chatgpt
- OpenAI Skills: https://developers.openai.com/api/docs/guides/tools-skills
- Claude Code MCP: https://code.claude.com/docs/en/mcp
- Claude Code skills: https://code.claude.com/docs/en/slash-commands
- Claude custom skills: https://support.claude.com/en/articles/12512198-how-to-create-custom-skills
