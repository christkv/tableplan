# Implementation Progress

Last updated: 2026-07-20

This is the restart ledger for Tableplan. Update it after every verified
checkpoint. A phase is complete only when its acceptance criteria are met; an
implemented local path is not evidence that cloud resources or third-party
OAuth have been verified.

## Current Checkpoint

- **Usable checkpoint:** Local MVP with a deterministic recipe sample,
  first-party authentication, recipe/favorite UI, weekly planning, combined
  shopping lists, private recipe text ingestion/review/edit/share, scoped REST
  API keys, OpenAPI, MCP tools, and Agent Skills.
- **Active phase:** Phase 10 - Vector and Hybrid Search.
- **Status:** Blocked on provisioned Workers AI/Vectorize preview bindings for
  end-to-end implementation and relevance measurement. FTS remains the active,
  required fallback.
- **Next local task:** Fresh desktop/mobile screenshot and accessibility pass
  for Phases 13-14; Phase 10 embedding fixtures remain independently ready.
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
- Authenticated Streamable HTTP MCP server with thirteen read/write-annotated tools
  and structured results.
- Credential-free REST, MCP, and import-administration Agent Skills under
  `src/skills/`.
- Serving-aware recipe/plan/shopping/combined print exports, account-email
  delivery, and expiring login-free store checklists.
- Owner-managed household invitations with relationship labels, captured/queued
  email, new password-account setup, existing-account acceptance, and shared
  household selection.
- Meal-plan recipe links resolve a household-scoped plan-item context, display
  the planned date/section/servings, scale the recipe to that serving count, and
  propagate contextual serving edits back to the plan and linked shopping list.
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
| 13. Private recipe ingestion | Implemented locally | Ownership migration, local text path, R2 artifacts, AgentWorkflow with separate OpenRouter text/vision model chains and Workers AI document conversion, review/mapping, edit/share, REST/MCP, and cross-account isolation pass; live cloud extraction and fresh browser screenshots remain |
| 14. PDF/email/public checklists | Implemented locally | Four local print previews, hashed/revocable capability links, mobile checklist, account-email capture, Queue/Email/Browser bindings, REST/MCP, and tests implemented; preview PDF rendering and real email delivery remain |
| 15. Household accounts/invitations | Implemented locally | Owner invite/revoke UI, relationship-aware memberships, seven-day hashed capabilities, Better Auth account setup, existing-account acceptance, local capture, queue dispatch, and live shared-household smoke pass; real preview email remains |

## Verification Log

| Date | Verification | Result |
| --- | --- | --- |
| 2026-07-20 | Planned recipe context quality gate | `npm run check` passed: generated Cloudflare/route types, TypeScript, 121 tests across 26 files, client build, and Worker SSR build |
| 2026-07-20 | Contextual planned-recipe live smoke | Opened a four-serving `13 Bean Chili` plan entry through its item-scoped recipe link; detail showed the source week, Monday/Dinner, four servings, and 0.8-scaled ingredients; increasing to five updated the plan and recipe to source quantities, then the original four servings were restored |
| 2026-07-20 | Planned recipe context tests | Added household/recipe-scoped plan-item lookup and bounded contextual serving adjustment coverage; focused planning and quantity suites passed 14 tests |
| 2026-07-19 | Household accounts quality gate | `npm run check` passed: generated Cloudflare/route types, TypeScript, 119 tests across 26 files, client build, and Worker SSR build |
| 2026-07-19 | Household invitation live smoke | Owner created a captured flatmate invitation; the recipient exchanged the fragment token, created a Better Auth username/password account, joined the owner's household, saw both members in Settings, and token reuse returned HTTP 410; smoke data was removed |
| 2026-07-19 | Household invitation migration/tests | Applied `0007_household_invitations.sql` to existing local D1; focused capability, email, and household resolver suites passed 9 tests across 3 files |
| 2026-07-19 | Official OpenRouter SDK migration | Replaced the hand-written Chat Completions transport with `@openrouter/sdk@0.13.66`, retained operation-specific model/fallback routing, strict schema and private-data provider policy, disabled secret-bearing SDK debug logs, added bounded SDK/HTTP diagnostics, and bound injected fetch to `globalThis` for Cloudflare Workers |
| 2026-07-19 | SDK vision Agent smoke | Uploaded a PNG through the local browser action; the Agent and Workflow called `google/gemini-2.5-flash` through the official SDK, received a structured completion, saved the draft, reported review-ready, and completed successfully |
| 2026-07-19 | OpenRouter SDK quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 111 tests across 24 files, client build, and Worker build |
| 2026-07-19 | Configurable console logging | Added `LOG_LEVEL=DEBUG|INFO|ERROR` with local `DEBUG` and deployed `INFO` defaults, level-filtered structured Tableplan logging, and private-safe request/Agent/Workflow/model lifecycle events; a live local OpenRouter ingestion showed dispatch, progress, retry, and terminal error callbacks without source/account/key data |
| 2026-07-19 | Logging quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 109 tests across 24 files, client build, and Worker build |
| 2026-07-19 | Dynamic local auth origins | Replaced the fixed port `5173` trust list with loopback-only wildcard ports for `localhost`, `127.0.0.1`, and `::1`; verified username sign-in on Vite port `5175` over hostname and IPv6, confirmed an external cookie-bearing origin returns HTTP 403, and passed the 103-test full quality gate |
| 2026-07-19 | Deterministic local test account | Added loopback-only `npm run seed:test-user`, documented `tableplanlocal` / `local-test@tableplan.test` credentials, verified repeat seeding, and received HTTP 200 from both username and email sign-in endpoints |
| 2026-07-19 | Recipe upload chooser and drag/drop | Replaced programmatic hidden-input clicks with a native file input overlay spanning the full drop zone; browser-verified chooser modal, overlay-targeted drop synchronization, generic-MIME DOCX acceptance, selected filename/size, clear action, and 390px layout without overlap |
| 2026-07-19 | Upload component quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 103 tests across 23 files, client build, and Worker build |
| 2026-07-19 | Extraction environment names and upload guard | Renamed configuration to `RECIPE_EXTRACTION_PROVIDER` and provider-owned `OPENROUTER_*_MODEL` chains; verified TXT upload reaches review and unconfigured image upload stays on the source form without creating a dead D1 ingestion row |
| 2026-07-19 | Upload/configuration quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 99 tests across 22 files, client build, and Worker build |
| 2026-07-19 | Operation-specific OpenRouter models | Split recipe processing into configurable text/document and vision primary/fallback chains; JPEG/PNG/WebP now use direct private multimodal input while PDF/DOCX/ODT retain Workers AI document conversion before text extraction |
| 2026-07-19 | Text/vision model quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 95 tests across 21 files, client build, and Worker build; live multimodal preview extraction remains pending a provisioned secret and cloud resources |
| 2026-07-19 | OpenRouter extraction provider | Replaced provider-specific recipe inference with a direct OpenRouter adapter; added configurable primary/three-model fallback routing, strict JSON Schema, ZDR/no-data-collection routing, actual-model audit storage, official/EU endpoint validation, secrets/configuration documentation, and retained deterministic local extraction |
| 2026-07-19 | OpenRouter quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 93 tests across 21 files, client build, and Worker build; live OpenRouter/preview extraction remains pending a provisioned secret and cloud resources |
| 2026-07-17 | Phase 14 local migration | `0006_pdf_email_public_checklists.sql` applied to existing local D1 state successfully |
| 2026-07-17 | Phase 14 end-to-end HTTP smoke | Created account/plan/list; verified four print previews, serving scaling, capability exchange, public read/toggle propagation, capture email status, hashed-token storage, revoke, and 410 after revoke |
| 2026-07-17 | Phase 14 quality gate | `npm run check` passed: generated bindings/routes, TypeScript, 87 tests across 20 files, client build, and Worker build |
| 2026-07-17 | Phase 14 implementation | Added migration, export renderers, four PDF/preview routes, public capability checklist, email capture/cloud Queue path, UI, REST/MCP contracts, tests, and operations documentation |
| 2026-07-17 | PDF/email/public checklist plan | Added Phase 14 with four PDF exports, account-email delivery, revocable login-free checklist capabilities, Cloudflare bindings/Queues, security controls, tests, and rollout gates |
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
| 2026-07-17 | Private recipe ingestion plan | Added Phase 13 covering user-private ownership, R2 artifacts, Agents plus Workflows, structured extraction, ingredient review, approval, and privacy testing |
| 2026-07-17 | Private recipe migration | Applied `0004_private_recipe_ingestion.sql` locally; existing 4,927 recipes remain catalog-visible and ownership/job/alias/audit tables are active |
| 2026-07-17 | Private recipe quality tests | 15 files/65 tests pass, including deterministic extraction, access predicates, OpenAPI, and thirteen-tool MCP discovery; production client/SSR build passes |
| 2026-07-17 | Private recipe live smoke | Pasted text produced a four-ingredient/three-step review, canonical mappings, private publication, owner-scoped search, edit/share controls, and plan eligibility after sharing |
| 2026-07-17 | Cross-account privacy smoke | A second local account received 404 for both private and other-household shared recipe IDs; private detail omitted Add to plan |
| 2026-07-17 | Recipe serving adjustment | Added detail-page stepper/manual serving input, quantity/range scaling before US/EU conversion, plan handoff, REST/MCP serving parameters, and unresolved-line preservation |
| 2026-07-17 | Serving adjustment verification | `npm run check` passed with 15 files/69 tests and both production builds; live 4-to-8 serving smoke doubled all four parsed ingredient quantities and reported scale 2 |
| 2026-07-17 | Serving stepper synchronization | Keyed the manual serving form to loader state so plus/minus navigation remounts the middle input with the newly selected count |
| 2026-07-17 | Plan/list serving propagation | Added inline planned-serving edits plus REST and MCP writes; additions, copies, removals, serving changes, and owned recipe edits now refresh any linked list in place while preserving checked items |
| 2026-07-17 | Shopping source plan | Shopping-list data and UI now identify the source plan by name, date range, meal count, and a link back to its week |
| 2026-07-17 | Live propagation smoke | Updating one planned meal from 4 to 8 servings retained the shopping-list ID and doubled garlic, oil, spaghetti, and tomato quantities; the response identified the correct source week and one planned meal |
| 2026-07-17 | Checked-item retention smoke | Checked spaghetti remained checked when the planned meal changed from 8 to 10 servings; its amount recalculated to 1 kg without replacing the shopping-list ID |
| 2026-07-17 | Serving propagation quality gate | `npm run check` passed: generated Cloudflare/route types, TypeScript, 15 files/71 tests, client build, and Worker SSR build |
| 2026-07-17 | Contextual plan-slot selection | Plan-cell Add links now preserve week, date, and slot through recipe search, facets, saved searches, detail, favorite actions, and serving adjustments; the recipe action writes directly to the originating slot |
| 2026-07-17 | Contextual add live smoke | Selecting Garlic Chicken N Gravy for the empty 2026-07-18 lunch cell created a four-serving item on that exact date/slot; the temporary item was removed after verification |
| 2026-07-17 | Contextual add quality gate | `npm run check` passed: generated Cloudflare/route types, TypeScript, 16 files/74 tests, client build, and Worker SSR build |
| 2026-07-17 | Custom meal sections | Added ordered household meal-section settings with stable IDs, editable labels, add/remove/reorder controls, planner/context integration, and REST/MCP validation against configured sections |
| 2026-07-17 | Custom meal-section migration | Applied `0005_custom_meal_slots.sql` locally; existing households receive Breakfast, Lunch, Dinner, and Snack defaults |
| 2026-07-17 | Custom section live smoke | Reordered sections, renamed Dinner to Supper, removed Snack, and added After school; the existing dinner meal remained attached under Supper and contextual links used `after-school`; defaults were restored after verification |
| 2026-07-17 | Custom section quality gate | `npm run check` passed: generated Cloudflare/route types, TypeScript, 17 files/78 tests, client build, and Worker SSR build |
| 2026-07-17 | Recipe card title headers | Replaced misleading one-character/quote tiles with full recipe titles in stable three-line headers on Recipes and Favorites; live SSR showed quoted titles correctly and `npm run check` passed with 17 files/78 tests plus both builds |
| 2026-07-17 | Compact recipe card headers | Reduced recipe title headers from 96px/three lines to a stable 70px/two lines to remove excess vertical space while preserving aligned card rows |
| 2026-07-17 | Single-line recipe card headers | Tightened recipe and favorite card headers to 48px with one-line ellipsis titles and full-name hover text |
| 2026-07-17 | Infinite recipe scrolling | Added deterministic offset pagination and an intersection-observer recipe grid that preloads 24 more cards near the viewport while retaining all text, ingredient, tag, scope, and plan-slot filters; includes deduplication, loading, completion, and retry states |
| 2026-07-17 | Infinite scrolling verification | Live offset 0/24 requests returned two unique 24-card pages from 4,928 recipes with zero overlap; `npm run check` passed with 17 files/79 tests plus client and Worker builds |

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
- User recipes default to `user_private`; shared plans accept only catalog or
  explicitly household-visible recipes. Unknown private ingredient terms remain
  unresolved or use household aliases rather than mutating global vocabulary.

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
- Local Better Auth origin validation accepts any port only for the loopback
  hosts `localhost`, `127.0.0.1`, and `::1`. This supports Vite's automatic port
  selection while preview and production remain restricted to their configured
  public origin.
- Do not modify `data/recipes_ingredients.csv`.
- A local test account, plan, favorite, shopping list, and revoked/active test
  key metadata may exist in ignored local D1 state.
- Preview and production identifiers in `wrangler.jsonc` are placeholders.
