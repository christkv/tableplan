# Family Meal Planner Application Plan

Date: 2026-07-16

## Goal

Build a Cloudflare-hosted family meal planner from `data/recipes_ingredients.csv` with:

- Google login and first-party email/password plus username accounts.
- A searchable recipe catalog with recipe drill-down, favorites, and collections.
- Family meal planning by date and meal slot.
- Scaled recipe quantities and combined shopping lists.
- US and EU/metric measurement display with conversion where conversion is mathematically valid.
- Hybrid search: semantic vector search, full-text search, tags, and ingredient filters.
- shadcn/ui React interface.

## Dataset Findings

Local dataset inspection:

- `data/recipes_ingredients.csv` has 500,471 recipe rows and is about 793 MB.
- Columns: `id`, `name`, `description`, `ingredients`, `ingredients_raw`, `steps`, `servings`, `serving_size`, `tags`.
- `ingredients` and `tags` are mostly parseable list data: 500,460 rows parsed cleanly for ingredient/tag analysis.
- `ingredients_raw` contains raw quantity/unit strings and should be treated as the source of truth for shopping-list quantities.
- `steps` has about 85,210 JSON parse failures, mostly from unescaped embedded quotes such as `don"t`; import must use a tolerant parser and quarantine rows it cannot repair.
- There are 247,313 unique normalized ingredient phrases, so canonicalization and aliasing are required.
- Common serving counts are family-sized, especially 4, 6, 1, 8, and 12 servings, but 2,494 rows have servings above 50 or invalid/edge values and need quality flags.
- The archive contains only the same CSV.

Dataset provenance appears to match the Kaggle "Food.com Recipes with Ingredients and Tags" dataset, listed as CC0/Public Domain. Still verify provenance and keep source attribution before public release.

## Recommended Stack

Use a Cloudflare-first full-stack React application:

- Framework: React Router full-stack app on Cloudflare Workers with the Cloudflare Vite plugin.
- UI: shadcn/ui, TypeScript, Tailwind CSS, Base UI-backed shadcn components for a new project.
- Auth: Better Auth with D1 as the database, Google OAuth, email/password, and username plugin.
- Database: Cloudflare D1 for relational data.
- Search:
  - D1 FTS5 for keyword/name/ingredient/tag search.
  - Cloudflare Vectorize for recipe-level semantic search.
  - Workers AI `@cf/baai/bge-base-en-v1.5` for 768-dimensional embeddings.
- Background work:
  - Local import scripts for the initial bulk import.
  - Cloudflare Queues for async embedding jobs, re-indexing, and future enrichment.
  - R2 for raw source files, import artifacts, and generated reports if needed.

Cloudflare sizing notes:

- The CSV is too large for D1 Free once normalized and indexed; plan on Workers Paid.
- D1 has a 10 GB per-database paid limit, so do not store the raw CSV or bulky import artifacts in D1.
- Vectorize supports up to 10M vectors per index, enough for one vector per recipe.
- Vectorize metadata indexes are limited, so use metadata only for coarse filters; keep rich filtering in D1.

## Core Product Features

### Accounts and Households

- Sign in with Google.
- Sign up/sign in with email and password.
- Optional username sign-in for first-party accounts.
- Household creation after first login.
- Invite household members by email.
- Roles: owner, adult, viewer. Children can be handled later if needed.
- Household-level preferences:
  - Default serving count.
  - Preferred measurement system: US, metric/EU, or original.
  - Dietary preferences and hard exclusions/allergies.
  - Shopping categories or aisle ordering.

### Recipe Library

- Search page with hybrid search and filters:
  - Semantic query: "quick vegetarian dinners with chickpeas".
  - Exact text query.
  - Include/exclude ingredients.
  - Tags: meal type, cuisine, time, diet, equipment.
  - Servings range and ingredient count.
- Result cards with title, tags, ingredient preview, default servings, and parse quality indicator.
- Recipe detail:
  - Description.
  - Scaled ingredients.
  - Original raw ingredients.
  - Steps.
  - Tags.
  - Serving scaler.
  - Unit-system toggle.
  - Favorite/save controls.
  - Add to meal plan.

### Favorites and Collections

- Favorite/unfavorite per user.
- Household collections: "Weeknight", "Kids", "Freezer", "Guests".
- Notes per saved recipe.
- Optional later: ratings, cooked history, "do not show again".

### Meal Planning

- Weekly calendar as the primary planning surface.
- Slots: breakfast, lunch, dinner, snack, custom.
- Add recipe from search/detail/favorites.
- Per-plan-item servings override.
- Notes and leftovers flag.
- Drag or move meal items between days.
- Duplicate week, clear week, copy previous week.

### Shopping List

- Generate from a date range or meal plan.
- Aggregate ingredients by canonical ingredient, unit dimension, and preparation.
- Show source recipes for each shopping item.
- Preserve unresolved raw ingredients instead of silently dropping them.
- Manual additions.
- Check off items.
- Group by grocery category/aisle.
- Toggle display between US, metric/EU, and original units.
- Export/share later: printable view, clipboard, CSV, or mobile PWA offline mode.

## Measurement and Quantity Model

Store quantities in normalized base units while preserving the original line.

Unit dimensions:

- Mass: grams, kilograms, ounces, pounds.
- Volume: milliliters, liters, teaspoons, tablespoons, cups, fluid ounces, pints, quarts, gallons.
- Count: each, clove, slice, egg, bunch, pinch, dash.
- Package: can, bottle, bag, box, package, packet, jar.
- Temperature: Fahrenheit/Celsius for steps, post-MVP.

Rules:

- Convert within the same dimension automatically.
- Store mass internally as grams, volume as milliliters, count as count.
- Handle ranges with `quantity_min` and `quantity_max`.
- Convert US volume to metric volume directly, for example cups to milliliters.
- Convert pounds/ounces to grams directly.
- Do not convert volume to mass unless an ingredient density exists.
- Keep package units as package/count unless a package size is parsed, for example `1 (14 ounce) can`.
- Keep "to taste", "as needed", and unknown quantities as unresolved but visible.

Ingredient density:

- Start with a curated density table for common ingredients: flour, sugar, butter, milk, oil, rice, oats, etc.
- Let users override or confirm ambiguous conversions later.
- USDA FoodData Central can be useful for nutrition enrichment, but it is not a complete density table.

## Data Model

Auth tables are managed by Better Auth.

Application tables:

- `households`
- `household_members`
- `user_profiles`
- `household_preferences`
- `recipes`
- `recipe_steps`
- `recipe_raw_ingredients`
- `ingredients`
- `ingredient_aliases`
- `recipe_ingredients`
- `units`
- `tags`
- `recipe_tags`
- `favorites`
- `collections`
- `collection_recipes`
- `meal_plans`
- `meal_plan_items`
- `shopping_lists`
- `shopping_list_items`
- `pantry_items` (post-MVP)
- `recipe_search_fts` virtual table
- `recipe_embeddings`
- `import_runs`
- `import_issues`

Important fields:

- `recipes`: source id, name, description, servings, serving size text, serving grams, quality flags.
- `recipe_ingredients`: raw line, parsed quantity, quantity range, parsed unit, canonical ingredient id, preparation text, parse status.
- `ingredients`: canonical name, aliases, grocery category, optional density.
- `meal_plan_items`: date, slot, recipe id, planned servings, scale factor.
- `shopping_list_items`: canonical ingredient id, display name, quantity base, unit dimension, checked state, source recipe ids, unresolved flag.

## Import Pipeline

1. Verify dataset license/provenance and record source metadata.
2. Create local SQLite staging database using the production schema.
3. Stream the CSV and preserve the original row id and raw row payload for audit.
4. Parse list columns:
   - Use strict JSON parsing first.
   - Use tolerant fallback parsing for malformed `steps`.
   - Quarantine unrecoverable rows into `import_issues`.
5. Parse raw ingredients:
   - Use a recipe ingredient parser as a starting point.
   - Extend unit aliases for dataset-specific variants: `pkge`, `pkg`, `can`, `bag`, `dash`, `pinch`, ranges, parenthetical package sizes.
6. Canonicalize ingredients:
   - Use the cleaned `ingredients` column as the first canonical hint.
   - Build ingredient aliases from frequency analysis.
   - Keep low-confidence parses visible and unresolved.
7. Normalize tags and recipe text.
8. Build FTS5 index over name, description, tags, ingredients, and selected step text.
9. Generate embedding text per recipe, capped to the embedding model input limit:
   - Name.
   - Description.
   - Tags.
   - Cleaned ingredients.
   - Short step summary or first steps.
10. Generate embeddings in batches and upsert to Vectorize.
11. Dump local SQLite schema/data to SQL chunks and import into D1 with `wrangler d1 execute --file`.
12. Produce QA reports:
   - Row counts by table.
   - Ingredient parse coverage.
   - Step parse coverage.
   - Serving outliers.
   - Unresolved unit counts.
   - Search index coverage.

## Search Plan

Use hybrid search, not vector-only search.

Query flow:

1. Normalize the query and filters.
2. If the query has semantic text, embed it with Workers AI.
3. Query Vectorize for semantic candidates.
4. Query D1 FTS5 for keyword candidates.
5. Apply hard filters in D1:
   - Household allergies/exclusions.
   - Include/exclude ingredients.
   - Tags, meal type, cuisine, equipment, time labels.
6. Merge/rank candidates:
   - Semantic score.
   - FTS score.
   - Exact ingredient matches.
   - Favorite/cooked history boosts.
   - Parse quality penalty.
7. Return paginated results with facets from D1.

Vectorize metadata should only store coarse values such as `course`, `diet_flags`, `time_bucket`, and `serving_bucket`, because metadata indexes are limited. Ingredient filters belong in D1.

## UI Plan

Main app shell:

- Sidebar on desktop, bottom navigation on mobile.
- Primary sections: Plan, Recipes, Favorites, Shopping List, Settings.

shadcn/ui components:

- `Sidebar` for navigation.
- `Command` for global search and quick add.
- `Data Table` for import/admin reports.
- `Calendar` or custom week grid for planning.
- `Sheet` or `Drawer` for recipe preview.
- `Dialog` for add-to-plan and household invite.
- `Tabs` for ingredients/steps/notes.
- `Toggle Group` for unit systems and meal slots.
- `Combobox` for ingredients/tags.
- `Slider` or stepper controls for servings.
- `Checkbox` for shopping list items.
- `Sonner`/toast for saves and generated lists.
- `Tooltip` for parse-quality and conversion explanations.

Design direction:

- Build the usable app first, not a landing page.
- Dense but readable family productivity UI.
- Recipe cards should be compact and scannable.
- The weekly plan and shopping list should be optimized for repeated use on mobile.

## Deployment Plan

Environments:

- `local`
- `preview`
- `production`

Cloudflare bindings:

- `DB`: D1 database.
- `VECTORIZE`: recipe vector index.
- `AI`: Workers AI binding.
- `IMPORT_QUEUE`: background import/index jobs.
- `ASSETS_BUCKET`: optional R2 bucket for raw source/import artifacts.

Secrets:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- Email provider API key for verification/password reset.

CI checks:

- Typecheck.
- Unit tests for parsers, conversion, aggregation, and authorization.
- Import smoke test on a small fixture.
- Build.
- Optional Playwright smoke tests.
- Deploy with Wrangler.

## Delivery Roadmap

The canonical execution roadmap is split into detailed documents under [`docs/phases`](phases/README.md). Its release gates are:

- **Local product prototype, Phases 0-5:** bootstrap, identity/households, sample import, recipe discovery/favorites, quantity conversion, meal planning, and shopping lists.
- **External developer preview, Phases 6-7:** versioned REST/OpenAPI, scoped API keys, and remote MCP tools.
- **Assistant integration preview, Phases 8-9:** ChatGPT/Claude experiences and portable Agent Skills.
- **Semantic-search preview, Phase 10:** Workers AI embeddings, Vectorize, hybrid ranking, and FTS fallback.
- **Production catalog launch, Phase 11:** full reviewed import, search indexing, preview rehearsal, and production rollout.
- **Operational readiness, Phase 12:** security, observability, privacy lifecycle, performance, cost controls, and recovery exercises.

This sequencing deliberately uses a representative sample during feature development. The full dataset is loaded only after schema, API, MCP, and search contracts are stable enough to avoid costly re-imports.

## Key Risks

- Data quality: malformed step arrays and noisy ingredient strings require a real import QA loop.
- D1 size: normalized recipe/ingredient tables plus FTS indexes may approach the 10 GB per-database paid limit. Keep raw artifacts in R2 and monitor database size early.
- D1 write throughput: full import and re-indexing must be chunked, preferably staged locally and imported as SQL.
- Measurement conversion: volume-to-mass conversion is ingredient-specific. Never fake these conversions without density data.
- Vector search filtering: Vectorize is excellent for semantic candidates but not a replacement for relational filtering.
- Email/password auth requires an email provider for verification and password reset.
- Dataset licensing/provenance should be verified before public/commercial launch.

## References

- Cloudflare React Router guide: https://developers.cloudflare.com/workers/framework-guides/web-apps/react-router/
- Cloudflare D1 limits: https://developers.cloudflare.com/d1/platform/limits/
- Cloudflare D1 import/export: https://developers.cloudflare.com/d1/best-practices/import-export-data/
- Cloudflare D1 SQL and FTS5 support: https://developers.cloudflare.com/d1/sql-api/sql-statements/
- Cloudflare Vectorize limits: https://developers.cloudflare.com/vectorize/platform/limits/
- Cloudflare Vectorize metadata filtering: https://developers.cloudflare.com/vectorize/reference/metadata-filtering/
- Cloudflare Workers AI BGE embeddings: https://developers.cloudflare.com/workers-ai/models/bge-base-en-v1.5/
- Cloudflare Queues: https://developers.cloudflare.com/queues/reference/how-queues-works/
- Better Auth Google provider: https://better-auth.com/docs/authentication/google
- Better Auth email/password: https://better-auth.com/docs/authentication/email-password
- Better Auth username plugin: https://better-auth.com/docs/plugins/username
- Better Auth D1 support announcement: https://better-auth.com/blog/1-5
- shadcn/ui components: https://ui.shadcn.com/docs/components
- shadcn/ui changelog/Base UI default: https://ui.shadcn.com/docs/changelog
- FoodData Central API: https://fdc.nal.usda.gov/api-guide/
- Dataset provenance candidate: https://www.kaggle.com/datasets/realalexanderwei/food-com-recipes-with-ingredients-and-tags/data
