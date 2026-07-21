# Private Recipe Ingestion

## User Flow

1. Open **Recipes > Add recipe**.
2. Paste recipe text or choose TXT, Markdown, PDF, DOCX, ODT, JPEG, PNG, or WebP.
3. Wait for extraction, then correct title, servings, ingredients, steps, and tags.
4. Confirm canonical ingredient matches. Unknown ingredients remain unresolved;
   they are never inserted into the global ingredient vocabulary automatically.
5. Publish as **Only me** or explicitly share with the household.

Private recipes do not appear to other users, cannot enter shared plans, and
return 404 across UI, REST, and MCP. The owner can edit a published recipe or
share it later. A household recipe can be made private only when no household
meal plan references it.

## Runtime Paths

- `RECIPE_EXTRACTION_PROVIDER=local`: pasted text and text files use
  `extractRecipeFromText`; image/document uploads are rejected before a job or
  artifact is created.
- `RECIPE_EXTRACTION_PROVIDER=openrouter`: the named `RecipeIngestionAgent` starts
  `RecipeIngestionWorkflow`. The workflow reads the owned R2 object, uses
  Workers AI `toMarkdown` only to convert PDF/DOCX/ODT sources, and sends text
  or a private image directly to the operation's OpenRouter model chain. The
  workflow stores a schema-constrained D1 review draft and reports progress to
  the Agent.
- D1 is authoritative for ownership, job status, review data, recipes, aliases,
  and audit events. R2 stores original private source bytes.

## OpenRouter Configuration

OpenRouter is called through the official `@openrouter/sdk` TypeScript client
and its Chat Completions API. Select models with environment variables:

```dotenv
RECIPE_EXTRACTION_PROVIDER=openrouter
OPENROUTER_TEXT_MODEL=nvidia/nemotron-3-ultra-550b-a55b:free
OPENROUTER_TEXT_FALLBACK_MODELS=
OPENROUTER_VISION_MODEL=nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free
OPENROUTER_VISION_FALLBACK_MODELS=
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_APP_TITLE=Tableplan
OPENROUTER_API_KEY=replace-with-a-secret
```

Model selection is based on the ingestion operation:

| Operation | Inputs | Primary/fallback configuration |
| --- | --- | --- |
| Text extraction | Paste, TXT, Markdown, converted PDF/DOCX/ODT | `OPENROUTER_TEXT_MODEL`, `OPENROUTER_TEXT_FALLBACK_MODELS` |
| Vision extraction | JPEG, PNG, WebP | `OPENROUTER_VISION_MODEL`, `OPENROUTER_VISION_FALLBACK_MODELS` |

Each optional comma-separated fallback list is tried in order and supports up
to three distinct models. Images are sent as private base64 data URLs directly
to OpenRouter and are never exposed through a public R2 URL. OpenRouter filters
image requests to models and providers that accept image input. The resolved
model is saved on the ingestion job for audit and cost analysis. A model change
requires configuration and redeployment, not a code or schema change.

Requests normally require JSON Schema support and route only to endpoints that
support every supplied parameter. They deny data-collection endpoints and
require zero-data-retention processing. The two configured NVIDIA `:free`
models are explicit exceptions: they allow provider data collection, do not
require ZDR, and use schema-in-prompt extraction with defensive JSON parsing
because those endpoints do not advertise structured outputs. Recipe sources
sent to these free endpoints may be logged and used by NVIDIA to improve its
services. Do not upload personal or confidential information. The base URL is
restricted to HTTPS OpenRouter hosts; use `https://eu.openrouter.ai/api/v1`
when EU in-region processing is required.

The OpenRouter account must allow training-capable free providers, and the API
key must not have an account or guardrail-level ZDR requirement. Request-level
`zdr: false` does not override stricter account-wide policy.

Other free model endpoints that log prompts or outputs remain incompatible with
the private routing policy unless they are explicitly reviewed and added to the
compatibility allowlist in `src/ingestion/openrouter.ts`.

The SDK's own `debugLogger` and `OPENROUTER_DEBUG` options must remain disabled:
the SDK documentation warns that request debug output can include authorization
headers. Tableplan's `[tableplan]` logger records only bounded operational
metadata.

Keep `RECIPE_EXTRACTION_PROVIDER=local` for credential-free local iteration. To
exercise the cloud workflow locally, put the key in uncommitted `.dev.vars`,
set the provider to `openrouter`, and use real or remote Cloudflare bindings for the
Agent, Workflow, R2, and document `toMarkdown` conversion.

References:

- OpenRouter API and authentication: https://openrouter.ai/docs/api/reference/overview
- Structured outputs: https://openrouter.ai/docs/guides/features/structured-outputs
- Image inputs: https://openrouter.ai/docs/guides/overview/multimodal/image-understanding
- Model fallbacks: https://openrouter.ai/docs/guides/routing/model-fallbacks
- Provider routing and privacy: https://openrouter.ai/docs/guides/routing/provider-selection
- Available model IDs: https://openrouter.ai/docs/api/api-reference/models/get-models

## Limits

| Source | Limit |
| --- | ---: |
| Pasted text, TXT, Markdown | 100 KiB |
| JPEG, PNG, WebP | 12 MiB |
| PDF, DOCX, ODT | 20 MiB |

Unsupported media types return a validation error before any job is created.
The R2 key includes household, user, and ingestion IDs; it is never exposed as
a public URL.

## Database and Recovery

Apply migration `0004_private_recipe_ingestion.sql` in each environment before
deploying code that creates jobs:

```bash
npm run db:migrate:local
npm run db:migrate:preview
npm run db:migrate:production
```

Inspect recent local jobs:

```bash
npx wrangler d1 execute DB --local --command \
  "SELECT id, input_kind, status, progress_message, error_code, created_at FROM recipe_ingestions ORDER BY created_at DESC LIMIT 20"
```

A failed workflow can be diagnosed from the job error fields and Worker logs.
It cannot leave a partially searchable recipe because recipe creation happens
only during publish. Source retention/deletion automation remains an operations
task; delete R2 artifacts and job rows together under the same ownership policy.

With `LOG_LEVEL=DEBUG`, the console traces the ingestion using `[tableplan]`
events from `recipe-ingestion-request`, `recipe-ingestion-agent`, and
`recipe-ingestion-workflow`. Search by the ingestion ID to correlate dispatch,
Workflow progress, source loading/conversion, OpenRouter model resolution,
ingredient mapping, and completion or failure. Logs contain operational metadata
and result counts, not recipe text, uploaded bytes, account IDs, or API keys.
