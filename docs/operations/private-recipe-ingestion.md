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

- `RECIPE_EXTRACTION_MODE=local`: pasted text and text files use
  `extractRecipeFromText`; binary jobs fail safely with `cloud_ai_required`.
- `RECIPE_EXTRACTION_MODE=cloud`: the named `RecipeIngestionAgent` starts
  `RecipeIngestionWorkflow`. The workflow reads the owned R2 object, uses
  Workers AI `toMarkdown` for binary sources, requests schema-constrained JSON,
  stores a D1 review draft, and reports progress to the Agent.
- D1 is authoritative for ownership, job status, review data, recipes, aliases,
  and audit events. R2 stores original private source bytes.

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
