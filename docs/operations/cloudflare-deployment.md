# Cloudflare Deployment

## Environments

- `local`: Wrangler/Vite emulation and local D1 state.
- `preview`: isolated cloud resources, test OAuth clients, and non-production keys.
- `production`: production D1, Vectorize, AI, Queue, R2, OAuth, and secrets.

Never share D1 databases, API keys, OAuth credentials, Vectorize indexes, or queues between preview and production.

## Required Resources

Create environment-specific resources and replace placeholder IDs in `wrangler.jsonc`:

```bash
npx wrangler d1 create meal-planner-preview
npx wrangler d1 create meal-planner-production
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler r2 bucket create meal-planner-private-recipes-production
npx wrangler queues create tableplan-email-preview
npx wrangler queues create tableplan-email-preview-dlq
npx wrangler queues create tableplan-email-production
npx wrangler queues create tableplan-email-production-dlq
```

Private recipe ingestion requires R2, an OpenRouter account/key, and Workers AI
for PDF/office-document-to-text conversion. The Worker deployment
creates or updates the `RecipeIngestionAgent` Durable Object class and the
environment-specific `RecipeIngestionWorkflow` from `wrangler.jsonc`. Confirm
the account has Workers AI, Workflows, Durable Objects, and R2 enabled before
deploying preview. Vectorize and import queues remain future Phase 10/11
resources and are not required for private recipe ingestion.

PDF and shopping-list email additionally require Browser Rendering, Email
Service, the environment's email Queue, and the dead-letter Queue. Replace the
example sender and application URLs in `wrangler.jsonc`. Verify the sender
domain in Email Service and publish SPF, DKIM, and DMARC before enabling
`EMAIL_MODE=cloud`. `PUBLIC_APP_URL` must be the fixed public origin; emailed
links must never be derived from a request Host header.
Household invitations share this Queue and Email binding and require arbitrary
recipient delivery. Their account-setup URLs also use the fixed
`PUBLIC_APP_URL`.

## Secrets

Set secrets separately for each environment:

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env preview
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
npx wrangler secret put OPENROUTER_API_KEY --env preview
```

Repeat for production. Use distinct values. Never put `OPENROUTER_API_KEY` in
`wrangler.jsonc`. `BETTER_AUTH_URL`, `APP_ENV`, the selected OpenRouter model,
and other non-secret feature configuration may be Wrangler variables.

Before deployment, set `OPENROUTER_TEXT_MODEL` and
`OPENROUTER_VISION_MODEL` to appropriate OpenRouter model IDs. Each has
an optional comma-separated `*_FALLBACK_MODELS` chain of up to three IDs. The
vision chain must accept image input; all selected endpoints must support strict
JSON Schema and zero-data-retention routing. Keep
`OPENROUTER_BASE_URL=https://openrouter.ai/api/v1`, or use the official EU
endpoint when required. See `docs/operations/private-recipe-ingestion.md` for
the complete extraction configuration.

Set the non-secret `LOG_LEVEL` Wrangler variable to `DEBUG`, `INFO`, or `ERROR`.
The repository uses `DEBUG` locally and `INFO` in preview and production.
Temporarily enabling `DEBUG` in a deployed environment provides detailed Agent
and Workflow lifecycle events, but should be returned to `INFO` after diagnosis
to control log volume. Tableplan never intentionally logs private recipe source
contents or provider credentials.

## Migrate and Deploy Preview

```bash
npm run check
npm run db:migrate:preview
npm run deploy:preview
```

After deployment:

- Verify `/api/v1/health`.
- Complete Google and first-party sign-in tests.
- Invite a new household email, complete password setup from the delivered
  single-use link, and verify the account joins the inviter's plans and lists.
- Search and open a known imported recipe.
- Create a meal plan and generate a shopping list.
- Download all four export variants and inspect A4 and Letter output.
- Send a shopping list to the account email, open its link in a fresh logged-out
  mobile browser, toggle an item, then revoke the link and confirm access ends.
- Exercise a scoped test API key.
- Connect MCP Inspector and one supported assistant client.
- Paste and publish a private text recipe, then confirm a second account gets
  404 for its ID.
- Upload an image and verify the configured vision model was recorded; upload a
  PDF and verify the configured text model was recorded. Review and publish
  both, share one with the household, and add it to a plan.

## Deploy Production

Production requires a reviewed preview release and import plan:

```bash
npm run check
npm run db:migrate:production
npm run deploy:production
```

Do not combine schema migration, full catalog replacement, and application deployment into an unreviewed single command. The full recipe import follows `docs/operations/recipe-import.md`.

## OAuth URLs

Register exact preview and production callback URLs with Google and remote assistant clients. Do not use wildcard production redirects. Keep local callbacks in a separate development OAuth client where the provider permits it.

## Rollback and Forward Fix

- Cloudflare Worker code can be rolled back using deployment versions.
- D1 schema/data changes are forward-fixed from migrations or restored/rebuilt through a reviewed export/import procedure.
- Vectorize can be rebuilt from relational recipe IDs and embedding-document versions.
- Queue failures must leave FTS and normal application reads operational.
- Failed ingestion workflows retain an owned job and artifact for retry or
  support inspection; they do not create a recipe row.

## CI Deployment

CI runs `npm ci`, `npm run check`, then deploys with an environment-scoped Cloudflare API token. Production deploys should require protected-branch approval and should not expose secrets to preview builds from untrusted contributions.
