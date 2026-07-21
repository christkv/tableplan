# Phase 13: Private Recipe Ingestion

**Status (2026-07-17): Implemented locally.** Cloud image/document extraction,
preview deployment, retention automation, and fresh visual/accessibility QA
remain verification gates. See `docs/implementation-progress.md` for evidence.

Date: 2026-07-17

## Objective

Allow an authenticated user to create a private recipe by pasting recipe text,
uploading a supported document, or uploading/taking a photo. Use Cloudflare
Agents and Workflows to extract a structured draft, map ingredient lines to the
canonical ingredient vocabulary, require user review, and publish the recipe
without exposing it to other users or the public catalog.

This is a user-content workflow. It is separate from the administrator CSV
import pipeline in Phase 2.

## Recommended Product Decisions

1. New recipes default to `user_private`, not household or catalog visibility.
2. The creator may explicitly share a recipe with their household later.
3. A user-private recipe cannot be added to a shared household meal plan until
   the user confirms household sharing.
4. The LLM creates a draft only. It never directly inserts recipes, ingredient
   concepts, aliases, tags, or vectors.
5. Publishing always requires an explicit user review and approval.
6. The existing `ingredients` table remains the canonical shared vocabulary.
   Unknown terms remain visible and unmapped instead of silently creating
   global ingredient concepts.
7. Cloudflare Agent state is used for progress and live UI synchronization. D1
   remains the authoritative product and audit store.
8. R2 stores private source artifacts. Workflow payloads contain only IDs and
   object keys, never file bytes.

## Scope

### Inputs

- Paste or type recipe text.
- Upload one image from desktop or mobile camera.
- Upload a supported document.
- Retry extraction after a recoverable failure.
- Replace the source before publishing.

Initial allowlist:

- Text: `.txt`, `.md`.
- Documents: `.pdf`, `.docx`, `.odt`.
- Images: `.jpeg`, `.jpg`, `.png`, `.webp`.

HTML, XML, SVG, spreadsheets, animated images, and multi-file recipes remain
disabled initially even where the conversion service supports them. They add
content-security, script, layout, or multi-page-review complexity without being
necessary for the first useful workflow.

Recommended limits:

- Pasted text: 100 KiB.
- Image: 12 MiB.
- Document: 20 MiB.
- One source artifact per ingestion in the first release.
- Maximum extracted text: 150,000 characters before bounded recipe extraction.

The Worker must stream uploads to R2 and must not buffer the complete file in
memory. Cloudflare currently limits Worker memory to 128 MB and account-plan
request bodies to at least 100 MB, but the application limits should be much
smaller and based on the recipe use case.

### Structured Draft

The extraction schema contains:

```text
title
description
servings
servingSize
prepTimeMinutes?
cookTimeMinutes?
ingredientLines[]
instructionSteps[]
tags[]
sourceLanguage
fieldConfidence{}
warnings[]
```

Each ingredient line retains:

```text
rawLine
quantityMin?
quantityMax?
unitText?
ingredientText
preparation?
canonicalIngredientId?
mappingMethod
mappingConfidence
parseStatus
candidateIngredientIds[]
```

The original source and each raw ingredient line remain available throughout
review. The user can always publish an unresolved line as unresolved.

## Ownership and Authorization

Extend `recipes` with:

```sql
visibility            TEXT NOT NULL DEFAULT 'catalog'
  CHECK (visibility IN ('catalog', 'user_private', 'household'))
owner_user_id         TEXT REFERENCES "user"(id) ON DELETE CASCADE
owner_household_id    TEXT REFERENCES households(id) ON DELETE CASCADE
created_by_user_id    TEXT REFERENCES "user"(id) ON DELETE SET NULL
origin                TEXT NOT NULL DEFAULT 'dataset'
  CHECK (origin IN ('dataset', 'manual_text', 'upload'))
status                TEXT NOT NULL DEFAULT 'active'
  CHECK (status IN ('active', 'archived'))
```

Existing catalog rows migrate to `visibility = 'catalog'` and
`origin = 'dataset'`. Private recipe source IDs use `user:<recipe UUID>` so the
current non-null unique `source_id` contract remains valid.

Every recipe read must enforce this predicate in the shared repository layer:

```text
visibility = catalog
OR owner_user_id = current user
OR visibility = household AND owner_household_id is an authorized household
```

This predicate must cover:

- Search and result counts.
- Tag facets and ingredient filters.
- Recipe detail and favorites.
- Meal-plan insertion and shopping-list generation.
- REST and MCP reads.
- FTS and future Vectorize result resolution.

Do not rely on hiding private rows in the UI. Repository and service methods
must require an access context. Identifier substitution tests must prove that a
second user and a second household cannot read, edit, delete, favorite, plan,
or retrieve source artifacts for the recipe.

## Data Model

### Ingestion Jobs

```sql
recipe_ingestions
  id
  owner_user_id
  household_id
  input_kind              -- text, image, document
  status                  -- created, uploading, queued, extracting,
                          -- mapping, review_ready, publishing, complete,
                          -- failed, canceled
  workflow_instance_id
  agent_name
  source_artifact_id
  extraction_schema_version
  prompt_version
  model_id
  extracted_text_hash
  published_recipe_id
  error_code
  error_message_safe
  attempt_count
  created_at
  updated_at
  completed_at
```

Status transitions are validated in one domain service. Terminal jobs cannot
be restarted in place; retry creates a new attempt linked to the same job or a
new job with `retry_of_id`.

### Source Artifacts

```sql
recipe_source_artifacts
  id
  ingestion_id
  owner_user_id
  household_id
  r2_key
  original_filename
  media_type
  byte_size
  sha256
  created_at
  delete_after
  deleted_at
```

R2 object keys are unguessable and partitioned:

```text
households/<household-id>/users/<user-id>/recipe-ingestions/<job-id>/source
```

The bucket is private. Reads are proxied through an authenticated Worker route;
the application never exposes a permanent public R2 URL.

### Draft and Review

```sql
recipe_ingestion_drafts
  ingestion_id PRIMARY KEY
  draft_json
  extracted_text_r2_key
  schema_version
  revision
  reviewed_by_user_id
  reviewed_at
  created_at
  updated_at

recipe_ingestion_ingredient_reviews
  ingestion_id
  position
  raw_line
  parsed_json
  selected_ingredient_id
  mapping_method
  mapping_confidence
  candidate_ids_json
  user_confirmed
  PRIMARY KEY (ingestion_id, position)
```

Keep draft JSON versioned but publish into normal relational recipe, ingredient,
step, and tag tables. Runtime search and shopping code must not depend on draft
JSON.

### Ingredient Vocabulary

The existing `ingredients`, `ingredient_aliases`, `units`, and
`recipe_ingredients` tables remain first-class concepts.

Add:

```sql
household_ingredient_aliases
  household_id
  alias
  ingredient_id
  created_by_user_id
  confidence
  created_at
  UNIQUE (household_id, alias)
```

Household aliases are private and never affect another household. Do not insert
LLM suggestions into global `ingredient_aliases`.

For the first release, a genuinely unknown ingredient is published with
`ingredient_id = NULL`, its raw line, parse status, and confidence. A later
curation feature may introduce household-owned ingredient concepts if real
usage shows that unresolved custom ingredients are common.

Add an authenticated ingredient lookup service and combobox:

```http
GET /api/v1/ingredients/search?q=<text>&limit=20
```

It searches exact canonical names, aliases, and FTS/prefix candidates and
returns IDs, names, grocery categories, common aliases, and match reasons.

## Cloudflare Architecture

### Components

- React Router Worker: authenticated UI, API, source upload, and source preview.
- D1: jobs, drafts, authorization, canonical recipe data, ingredient concepts,
  and audit records.
- Private R2 bucket: source images/documents and optionally extracted text.
- `RecipeIngestionAgent`: one Agent instance per ingestion job.
- `RecipeIngestionWorkflow`: one durable Workflow instance per ingestion job.
- Workers AI `toMarkdown`: PDF/office-document text conversion.
- OpenRouter: separate selectable text and vision primary/fallback model chains,
  private multimodal routing, and JSON-schema recipe extraction.
- Vectorize/embedding queue: post-publish indexing only, after Phase 10 exists.

### Agent Responsibility

Use `RecipeIngestionAgent extends Agent` with the ingestion ID as its stable
instance name. Its state is small and contains no complete recipe or artifact:

```ts
interface RecipeIngestionAgentState {
  jobId: string;
  status: IngestionStatus;
  progress: number;
  currentStage: string;
  needsReview: boolean;
  draftRevision: number;
  safeError?: { code: string; message: string };
}
```

The Agent:

- Starts and tracks the workflow with `runWorkflow()`.
- Broadcasts progress to the creator's connected review page.
- Exposes authenticated callable methods for cancel, retry, approve, and reject.
- Mirrors status from D1 but is not the source of truth for recipe content.
- Never accepts `owner_user_id` or `household_id` from an untrusted client;
  those values come from the authenticated session.

Agent routes must pass through application authentication before
`routeAgentRequest()` dispatch. A random Agent name is not an authorization
boundary.

### Workflow Responsibility

Use `RecipeIngestionWorkflow extends AgentWorkflow`. Cloudflare recommends
Agent plus Workflow for long-running pipelines, retries, and human approval.

Workflow steps:

1. **Claim job**
   - Load job by ID and verify owner/household metadata.
   - Enforce idempotency and valid starting state.
2. **Load source**
   - Read the private R2 object by stored key.
   - Verify size, media type, and SHA-256 against D1.
3. **Convert source**
   - Text inputs pass through bounded decoding and normalization.
   - PDF/DOCX/ODT inputs use `env.AI.toMarkdown()`.
   - JPEG/PNG/WebP inputs remain private bytes and are sent directly to the
     configured OpenRouter vision model as base64 image content.
   - Store large converted text in R2; return only its key and hash from the
     Workflow step.
4. **Extract structured recipe**
   - Call the operation-specific OpenRouter text or vision model chain.
   - Require JSON Schema output.
   - Require no-data-collection and zero-data-retention provider routing by
     default. Explicitly reviewed collecting model IDs must use a narrow
     compatibility allowlist and show a user-facing processing disclosure.
   - Treat source text as untrusted data, not instructions. The model gets no
     tools and cannot make network or database calls.
5. **Validate and normalize**
   - Validate with a strict schema.
   - Bound title, arrays, line lengths, servings, and step count.
   - Run the existing deterministic quantity/unit parser on every raw line.
6. **Map ingredients**
   - Apply the deterministic mapping policy below.
   - Persist candidates, match reasons, and confidence.
7. **Persist review draft**
   - Write the draft and review rows idempotently.
   - Update D1 and Agent progress to `review_ready`.
8. **Wait for approval**
   - Use Workflow human-in-the-loop approval.
   - User edits are saved to D1 with optimistic `revision` checks.
9. **Publish**
   - Re-read the approved D1 revision.
   - Insert one user-private recipe and related relational rows in idempotent,
     bounded D1 batches.
   - Record `published_recipe_id` before reporting completion.
10. **Index and clean up**
    - Update FTS with owner/visibility-aware data.
    - Enqueue a private embedding only when Phase 10 privacy filters exist.
    - Set artifact retention and complete the job.

Workflow instance ID:

```text
recipe-ingestion-<ingestion-id>-v<workflow-version>
```

The Workflow event contains IDs and R2 keys only. Cloudflare currently limits
Workflow event payloads and normal step results to 1 MiB, and completed
Workflow state retention is finite. D1 and R2 therefore remain the durable
business record.

## Ingredient Mapping Policy

Ingredient identity affects scaling and shopping aggregation, so mapping must
be explainable and conservative.

For each extracted raw line:

1. Parse quantity and unit with the current deterministic parser.
2. Normalize the ingredient phrase with the existing normalizer.
3. Match an exact canonical ingredient name.
4. Match an exact global alias.
5. Match an exact household-private alias.
6. Retrieve up to five prefix/FTS candidates with match reasons.
7. Optionally ask the LLM to select only from those candidate IDs or return
   `unmapped`. It cannot invent an ID or create a concept.
8. Auto-accept only deterministic exact matches or reviewed model matches above
   a measured threshold.
9. Require user confirmation for lower-confidence and unmatched lines.
10. Save an optional household alias only when the user explicitly selects
    "Remember this mapping".

The review UI must show:

- Original line.
- Parsed quantity, range, unit, ingredient phrase, and preparation.
- Selected canonical ingredient and confidence/match reason.
- Candidate combobox.
- "Keep unmapped" action.
- Warning when an unmapped line will remain separate in shopping aggregation.

Do not use vector similarity as an authoritative ingredient mapping. It may
generate candidates later, but a relational ID selection remains required.

## User Experience

Add **My recipes** to recipe navigation and an **Add recipe** command.

Routes:

```text
/recipes/new
/recipes/import/:ingestionId
/recipes/:recipeId/edit
/recipes?scope=catalog|mine|household|all
```

### Create Screen

Use tabs for input modes:

- Write or paste.
- Upload file.
- Take/upload photo.

The first screen is the actual creation tool, not explanatory marketing.
Uploads show file name, type, size, replace, and remove controls. The submit
button starts extraction and moves to the progress/review route.

### Progress and Review

- Show current durable stage and retryable failure state.
- Stream Agent progress when connected; poll D1 status as fallback.
- Present editable title, description, servings, ingredient rows, steps, and
  tags after extraction.
- Keep the source preview available beside or below the draft without exposing
  a public asset URL.
- Mark low-confidence fields, not every field.
- Disable Publish until required title, at least one ingredient, and at least
  one instruction are valid.
- Publish requires an explicit button and creates the private recipe.

### Recipe Library

- Default catalog browsing remains unchanged.
- `My recipes` is a separate scope with a lock/private badge.
- Private recipes support edit, archive/delete, and explicit Share with
  household.
- Search and facets include private rows only in scopes the caller can access.
- The recipe detail page identifies the creator source and visibility without
  exposing the original upload to unauthorized users.

## API and MCP Contract

Add REST endpoints behind `recipes:write` or session authorization:

```http
POST   /api/v1/recipe-ingestions
PUT    /api/v1/recipe-ingestions/{id}/source
GET    /api/v1/recipe-ingestions/{id}
PATCH  /api/v1/recipe-ingestions/{id}/draft
POST   /api/v1/recipe-ingestions/{id}/approve
POST   /api/v1/recipe-ingestions/{id}/retry
DELETE /api/v1/recipe-ingestions/{id}
GET    /api/v1/ingredients/search
PATCH  /api/v1/recipes/{id}
DELETE /api/v1/recipes/{id}
POST   /api/v1/recipes/{id}/share-household
```

REST create returns `202 Accepted` with the job ID, status URL, and review URL.
Source upload and approve are separate operations so retries do not duplicate
binary uploads.

Add MCP tools only after the UI workflow is stable:

```text
start_recipe_ingestion_from_text
get_recipe_ingestion
update_recipe_ingestion_draft
approve_recipe_ingestion
```

MCP must not auto-approve extraction. File/image ingestion is omitted from the
first MCP contract because local client files are not automatically available
to a remote MCP server. A later contract may accept an already-uploaded
artifact ID, never an arbitrary URL fetched by the Worker.

## Local Development

Add bindings in each Wrangler environment:

```text
AI
PRIVATE_RECIPE_ASSETS        R2
RECIPE_INGESTION_AGENT       Durable Object / Agent
RECIPE_INGESTION_WORKFLOW    Workflow
```

Local development modes:

1. `mock`: fixture extractor and local R2/D1/Agent/Workflow state. This is the
   default for UI iteration and CI.
2. `remote-ai`: local app and storage with explicitly configured remote AI for
   prompt evaluation.
3. `preview`: full Cloudflare preview resources and AI Gateway.

Commit fixture sources for typed text, a clear photo, noisy handwriting, PDF,
ambiguous servings, ingredient ranges, unknown units, and unknown ingredients.
Never use a production user's private recipe as a test fixture.

## Implementation Increments

### 13A: Ownership and Manual Recipes

- Add visibility/ownership fields and access-context repository methods.
- Add My recipes scope and manual structured recipe editor.
- Publish user-private recipes without AI.
- Add authorization and search-leakage tests.

Exit: a user can manually create, edit, find, plan after sharing, and delete a
private recipe; another user cannot detect it.

### 13B: Artifacts and Ingestion Jobs

- Add private R2 binding, upload route, media sniffing, checksums, and limits.
- Add ingestion job/draft/review tables and status machine.
- Add source preview and retention cleanup.

Exit: text, image, and document artifacts are privately stored and represented
by a resumable D1 job without AI.

### 13C: Agent and Workflow Extraction

- Add `agents` dependency, Agent Durable Object, Agent migration, and Workflow.
- Integrate document `toMarkdown`, OpenRouter text/vision model chains, JSON
  Schema extraction, prompt/model versions, retry policy, and progress updates.
- Keep payload logging disabled for private recipe content.

Exit: fixture and preview sources reliably reach `review_ready`; failures can
be retried without duplicate drafts or recipes.

### 13D: Ingredient Review and Publishing

- Add ingredient search service, household aliases, candidate explanations,
  confidence policy, and review UI.
- Add durable approval and idempotent relational publish.
- Update FTS and all search/detail authorization paths.

Exit: an approved draft produces one private recipe whose ingredient mappings
work with scaling and shopping aggregation.

### 13E: External Contracts and Indexing

- Publish OpenAPI endpoints and MCP text-ingestion tools.
- Add audit events and API-key scope tests.
- Add private embeddings only after Vectorize metadata and D1 post-filter tests
  prove no cross-user leakage.

Exit: API/MCP clients can create and review text ingestions with the same
approval boundary as the browser.

### 13F: Hardening and Preview Gate

- Rate limits and per-user AI spend limits.
- Malicious file, prompt injection, oversized input, and decompression tests.
- Artifact retention/deletion and account export/delete integration.
- Accessibility, mobile camera, browser, retry, and interrupted-workflow tests.
- Cost, latency, conversion failure, model failure, and review-time dashboards.

Exit: the feature passes preview privacy, reliability, cost, and recovery
checks before production enablement.

## Test Plan

### Domain and Schema

- Visibility predicate matrix for catalog, user-private, and household recipes.
- Status-transition and idempotency tests.
- Structured extraction schema validation and bounds.
- Ingredient exact/alias/candidate/unmapped decisions.
- Existing quantity/unit parsing regression suite on extracted lines.
- Migration tests proving catalog rows remain catalog-visible.

### Integration

- Text, image, PDF, and DOCX fixtures through mock and preview extraction.
- Workflow retries after conversion, model, D1, and R2 failures.
- Approval waits across Worker/Agent eviction and deployment.
- Repeat approve/retry callbacks create exactly one recipe.
- Artifact deletion never deletes another user's object.
- Private recipe works in favorites, search, detail, conversion, and shopping
  after the required household-sharing decision.

### Security and Privacy

- Second user, second household, API key, and guessed Agent/job/recipe IDs.
- Private recipe names absent from unauthorized search counts, facets, FTS,
  MCP, OpenAPI responses, logs, and error messages.
- Prompt-injection text cannot invoke tools or alter workflow control fields.
- MIME type, extension, magic bytes, file size, and image dimension checks.
- AI Gateway stores metadata but no raw recipe payload.
- R2 bucket has no public access and source responses use safe content headers.

### Browser

- Paste recipe, review mappings, publish, search in My recipes.
- Mobile camera/photo upload and narrow review layout.
- Low-confidence correction and Remember this mapping.
- Failure, retry, cancel, stale revision, and duplicate submit states.
- Share with household before adding to a household plan.

## Observability and Cost Controls

Record per job:

- Input kind and byte/character count.
- Conversion duration and result size.
- Model ID, prompt/schema version, token count, cost, and latency.
- Mapping confidence distribution and user correction count.
- Time to review, publish, cancel, and failure code.

Do not record raw source text, extracted recipe content, R2 keys, presigned URLs,
or model payloads in normal application logs. Use AI Gateway metadata-only logs
and configure per-user/day spend limits before broad release.

## Retention and Deletion

- Unpublished artifacts: delete 7 days after last activity.
- Successfully published source artifact: default delete after 30 days; allow
  the user to delete immediately.
- Draft and Workflow diagnostic state: retain only as required for retry and
  support, then remove or redact.
- Published relational recipe: retain until user archive/delete or account
  deletion.
- Account deletion removes private recipes, drafts, jobs, household aliases
  created solely by that user where policy allows, R2 artifacts, vectors, and
  Agent/Workflow records.

Use R2 lifecycle rules as a backstop, but maintain explicit D1 tombstones and a
cleanup job so deletion can be audited.

## Acceptance Criteria

- A user can paste text or upload a supported image/document and receive an
  editable structured draft.
- No model output becomes a recipe without explicit user approval.
- Ingredient mappings are ID-based, explainable, and correctable; unknown
  ingredients remain visible.
- Publishing produces normal relational rows compatible with recipe detail,
  measurement conversion, favorites, search, planning, and shopping.
- User-private recipes and source artifacts are inaccessible and
  non-discoverable to another user and household.
- Workflow retries, duplicate submits, and approval callbacks create exactly
  one recipe.
- Local UI development and CI work with deterministic mocks and no cloud
  credentials.
- Preview tests cover real Agent, Workflow, R2, document `toMarkdown`, and both
  OpenRouter model chains before production enablement.

## Non-Goals

- Automatically publishing without review.
- Crawling arbitrary recipe URLs.
- Fetching arbitrary remote URLs supplied by MCP or users.
- Automatically expanding the global ingredient vocabulary from model output.
- Nutrition or allergen guarantees inferred by an LLM.
- Bulk cookbook import in the first release.
- Multi-image stitching, video, audio, or handwritten-recipe perfection.
- Training a custom extraction model before evaluation proves it necessary.

## Official Cloudflare References

- Agents quick start and routing:
  https://developers.cloudflare.com/agents/getting-started/quick-start/
- Agent state:
  https://developers.cloudflare.com/agents/runtime/lifecycle/state/
- Agents with Workflows:
  https://developers.cloudflare.com/agents/runtime/execution/run-workflows/
- Human-in-the-loop patterns:
  https://developers.cloudflare.com/agents/concepts/agentic-patterns/human-in-the-loop/
- Workflows overview and limits:
  https://developers.cloudflare.com/workflows/
  https://developers.cloudflare.com/workflows/reference/limits/
- Workers AI Markdown conversion and supported formats:
  https://developers.cloudflare.com/workers-ai/features/markdown-conversion/usage/rest-api/
  https://developers.cloudflare.com/workers-ai/features/markdown-conversion/supported-formats/
  https://developers.cloudflare.com/workers-ai/features/markdown-conversion/conversion-options/
- OpenRouter structured output and model routing:
  https://openrouter.ai/docs/guides/features/structured-outputs
  https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
  https://openrouter.ai/docs/guides/routing/model-fallbacks
  https://openrouter.ai/docs/guides/routing/provider-selection
- R2 upload and presigned URL patterns:
  https://developers.cloudflare.com/r2/objects/upload-objects/
  https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- AI Gateway logging controls:
  https://developers.cloudflare.com/ai-gateway/observability/logging/
- Worker limits:
  https://developers.cloudflare.com/workers/platform/limits/
