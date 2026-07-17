# Implementation Progress

Last updated: 2026-07-16

This is the restart ledger for Tableplan. Update it after every verified
checkpoint. A phase is complete only when its acceptance criteria are met; an
implemented local path is not evidence that cloud resources or third-party
OAuth have been verified.

## Current Checkpoint

- **Usable checkpoint:** Local MVP with a deterministic recipe sample,
  first-party authentication, recipe/favorite UI, weekly planning, combined
  shopping lists, scoped REST API keys, OpenAPI, MCP tools, and Agent Skills.
- **Active phase:** Phase 10 - Vector and Hybrid Search.
- **Status:** Blocked on provisioned Workers AI/Vectorize preview bindings for
  end-to-end implementation and relevance measurement. FTS remains the active,
  required fallback.
- **Next local task:** Add the versioned embedding document builder and
  relevance fixtures.
- **Next external task:** Provision preview D1, Workers AI, and Vectorize;
  replace placeholder IDs/URLs in `wrangler.jsonc`.

## Implemented

- React Router v8 SSR application on the Cloudflare Vite/Workers runtime with a
  responsive shadcn-style operational UI.
- D1 schema and migration for Better Auth, households, recipes, normalized
  ingredients/units, tags, favorites, plans, shopping lists, API keys, import
  audit rows, and FTS5.
- Better Auth email/password account creation, username or email sign-in,
  session protection, household bootstrap, logout, and optional Google provider
  configuration.
- Streaming CSV analysis/sample/stage/normalize/QA/export/apply CLI using local
  SQLite staging and checksummed source metadata.
- Ingredient quantity parsing, scaling, dimensional conversion, display
  formatting, and shopping aggregation with raw-text preservation for partial
  parses.
- Recipe browse, FTS search, ingredient filter, detail drill-down, favorites,
  weekly plan editing, and combined US/metric shopping-list snapshots.
- Scoped, hashed, expiring, revocable API keys shown once at creation.
- Authenticated REST endpoints plus an OpenAPI 3.1 document.
- Authenticated Streamable HTTP MCP server with six read/write-annotated tools
  and structured results.
- Credential-free REST, MCP, and import-administration Agent Skills under
  `src/skills/`.
- Run, import, API/integration, deployment, architecture, and per-phase
  documentation.

## Phase Status

| Phase | Status | Evidence / remaining gate |
| --- | --- | --- |
| 0. Project bootstrap | Complete locally | Install, generated types, tests, and production build pass |
| 1. Schema/auth/authorization | Implemented locally | Email/password signup and username/email sign-in smoke-tested on both local hostnames; Google and email delivery require credentials |
| 2. Import tool MVP | Complete locally | Corrected deterministic sample reconciles 500,471 seen rows to 4,927 accepted and 73 rejected duplicates; repeat apply preserves household foreign keys |
| 3. Recipe browser/search/favorites | Complete locally | Composable FTS, ingredient, and counted tag filtering plus detail and favorite paths are browser/API tested |
| 4. Units/quantity engine | Complete for MVP | Fraction/range parsing, compatible conversions, scaling, formatting, and aggregation tested |
| 5. Meal planning/shopping lists | Complete for MVP | Local plan item and generated shopping list smoke-tested |
| 6. REST/API keys/OpenAPI | Complete for MVP | Bearer search succeeded; OpenAPI contract and API-key primitives tested |
| 7. MCP server | Complete for API-key clients | Initialize, tool listing, and recipe search smoke-tested; protocol catalog test passes |
| 8. ChatGPT/Claude UX | Partial | Claude Code API-key connection is documented; ChatGPT OAuth 2.1 resource server is pending |
| 9. Agent Skills | Complete | All three skills pass `quick_validate.py` |
| 10. Vector/hybrid search | Not implemented | Needs preview AI/Vectorize bindings, embedding pipeline, ranking, and relevance evaluation |
| 11. Full import/production | Not started | Needs provenance/capacity approval, clean full staging, preview rehearsal, and cloud credentials |
| 12. Hardening/operations | Partial | Operations docs and local quality gate exist; rate limiting, audit events, CI/CD, load/accessibility/browser QA remain |

## Verification Log

| Date | Verification | Result |
| --- | --- | --- |
| 2026-07-16 | `npm install` | Passed; dependency audit reported zero vulnerabilities at install time |
| 2026-07-16 | `npm run db:migrate:local` | Passed; initial D1 migration applied |
| 2026-07-16 | Corrected `npm run import:sample` | Staging passed; scanned 500,471 rows, imported 4,927 unique recipes, and rejected 73 duplicates |
| 2026-07-16 | Local D1 checks | 4,927 unique recipes, 8,899 ingredients, and 945 FTS matches for `chicken` |
| 2026-07-16 | Browser-session auth smoke | Email signup, username sign-in state, protected redirect, and logout path exercised |
| 2026-07-16 | Product-flow HTTP smoke | Recipe detail, favorite, six-serving dinner plan item, and generated shopping list exercised |
| 2026-07-16 | REST API-key smoke | Scoped bearer recipe search succeeded |
| 2026-07-16 | MCP HTTP smoke | Initialize, six-tool listing, and `search_recipes` call succeeded |
| 2026-07-16 | Entity/import regression suite | Passed: named, numeric, and double-encoded entities plus deterministic duplicate retention and non-destructive SQL export |
| 2026-07-16 | Skill validation | Passed for REST, MCP, and import skills |
| 2026-07-16 | Initial `npm run check` | Passed: Wrangler types, React Router types, TypeScript, 33 tests, client build, and SSR build |
| 2026-07-16 | Local `/api/v1/health` | HTTP 200 with database status `ok` |
| 2026-07-16 | Responsive browser QA | Passed at 390x844 and 1440x900 for sign-in, recipes, ingredient filtering, detail, and plan; fixed local origin trust and mobile ingredient access |
| 2026-07-16 | Final `npm run check` | Passed after browser fixes: generated types, TypeScript, 35 tests, client build, and SSR build |
| 2026-07-16 | Catalog entity audit | Zero encoded entity patterns across recipes, ingredients, steps, tags, and FTS; sample names render with quotes/ampersands |
| 2026-07-16 | Repeat catalog apply | UPSERT apply passed while preserving one favorite and one meal-plan item |
| 2026-07-16 | Latest `npm run check` | Passed: generated types, TypeScript, 9 files/38 tests, client build, and SSR build |
| 2026-07-16 | Tag drill-down | Combined `chicken` + `garlic` + `main-dish` browser query returned 261 matches; selector update to `chicken` returned 202; mobile/desktop overflow checks passed |
| 2026-07-16 | Multi-tag facets and saved searches | Implemented contextual counted facets, repeated-tag All/Any search semantics, household saved-search persistence, REST endpoints, MCP tools, and API/skill documentation |
| 2026-07-16 | Facet/saved-search test pass | Passed generated types, TypeScript, and 11 files/48 tests before local D1/browser verification |
| 2026-07-16 | Saved-search migration | Applied `0002_saved_recipe_searches.sql` successfully to local D1 |
| 2026-07-16 | Live facet semantics | `chicken` + `garlic` contextual counts were 261 `main-dish` and 202 `chicken`; selecting both returned 154 with All and 309 with Any |
| 2026-07-16 | Saved-search live smoke | REST and browser-form create, list, same-name replace, recall URL, and delete paths passed with household scoping |
| 2026-07-16 | Nine-tool MCP smoke | Tool listing passed and multi-tag `search_recipes` returned the same 154 All-mode matches as the web route |
| 2026-07-16 | Facet/saved-search quality gate | `npm run check` passed: generated types, TypeScript, 11 files/48 tests, client build, and Worker SSR build |
| 2026-07-16 | Current visual QA limitation | In-app browser was not attached; authenticated live HTTP/SSR output was checked, but a fresh desktop/mobile screenshot pass remains pending |
| 2026-07-16 | Measurement settings | Added persisted Original/Metric (EU)/US settings and applied them to recipe details and normalized shopping-list display |
| 2026-07-16 | Previous-week cloning | Added guarded household week copying in the UI, REST, and MCP with weekday, slot, servings, notes, and leftovers preserved |
| 2026-07-16 | Meal-plan uniqueness migration | Applied `0003_unique_household_meal_plan_weeks.sql`; duplicate plan items are merged before enforcing one plan per household week |
| 2026-07-16 | Settings/clone live smoke | Metric setting persisted and rendered `1 lb` as `453.59 g`; two meals copied to matching weekdays and repeat copy returned `409 target_not_empty` |
| 2026-07-16 | Concurrent plan creation regression | Two simultaneous first writes resolved to one plan ID and retained both items after the household-week unique-index fix |
| 2026-07-16 | Settings/clone quality gate | `npm run check` passed: generated types, TypeScript, 14 files/58 tests, client build, and Worker SSR build |
| 2026-07-16 | Clean local restart | Development Worker restarted on `http://127.0.0.1:5173`; health, settings, and planner routes returned HTTP 200 |

Run `npm run check` and record the result after any code change.

## Resolved Data Findings

- The first sample run reported 5,000 imports while producing 4,927 unique
  recipes. The corrected rerun now reports 4,927 accepted plus 73 rejected
  duplicate source IDs and retains the earliest source row deterministically.
- HTML entities are decoded at the import boundary in every user-visible field,
  including bounded repeated decoding for double-encoded source values. The
  local relational and FTS catalogs now contain zero matching encoded values.
- Catalog SQL now uses primary-key UPSERTs instead of SQLite `REPLACE`, avoiding
  parent-row deletion and preserving favorites and meal-plan foreign keys during
  a refresh.

## Resume Procedure

From the repository root:

```bash
sed -n '1,280p' docs/implementation-progress.md
npm install
npm run db:migrate:local
npm run check
```

If local recipe counts are absent, run `npm run import:sample`. Then read the
active phase document under `docs/phases/` and the relevant operations runbook.

To inspect local state:

```bash
npx wrangler d1 execute DB --local --command "SELECT COUNT(*) AS recipes FROM recipes"
npx wrangler d1 execute DB --local --command "SELECT id, status, rows_seen, rows_imported, rows_rejected FROM import_runs ORDER BY started_at DESC LIMIT 3"
```

## Architecture Decisions

- React Router framework mode with SSR and the Cloudflare Vite plugin.
- D1 for production relational state and local Wrangler D1 for iteration.
- Node streaming CLI plus local SQLite staging for the approximately 793 MiB
  source file.
- Raw source values and parse status are retained beside normalized quantities.
- FTS is always available; semantic search must fail back to FTS.
- API keys are hashed at rest and resolved to one user and household.
- One household per user is the MVP default; membership tables preserve the
  path to shared family accounts.
- Repository skills are not installed into global assistant configuration.
- Recipe tag discovery uses facets, not a tag cloud. Counts are contextual to
  text and ingredient filters; selected tags default to All matching.
- Saved recipe searches are household-scoped and names are unique per household;
  saving an existing name replaces its filter definition.

## External Configuration

- Google OAuth needs environment-specific client IDs, secrets, and exact
  callback URLs.
- Account verification and password reset need an email provider.
- Preview/production D1, Vectorize, Workers AI, Queues, and optional R2 need a
  Cloudflare account and resource IDs.
- ChatGPT requires a public HTTPS MCP endpoint and an established OAuth 2.1
  provider satisfying the MCP resource-server flow; custom API keys are not a
  supported ChatGPT connector credential.
- Full production import requires dataset license/provenance approval and D1
  capacity review.

## Local-Only Paths

Do not commit `.dev.vars`, `.wrangler/`, `.react-router/`, `build/`,
`node_modules/`, `.import/`, SQLite files, SQL chunks, QA artifacts, embedding
dumps, or any API key.

## Handoff Notes

- The workspace was not a Git repository when implementation began.
- Do not modify `data/recipes_ingredients.csv`.
- A local test account, plan, favorite, shopping list, and revoked/active test
  key metadata may exist in ignored local D1 state.
- Preview and production identifiers in `wrangler.jsonc` are placeholders.
