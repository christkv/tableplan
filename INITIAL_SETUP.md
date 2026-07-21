# Initial Cloudflare Setup

This guide provisions Tableplan in Cloudflare for the first time. Deploy to the
isolated `preview` environment first. Create production resources only after the
preview release has passed its smoke tests.

> Storage transition: the checked-in Cloudflare environments still use D1 so an existing deployment is not changed accidentally. The application is now capable of using the bounded MongoDB gateway. For a new MongoDB-backed installation, complete the D1 bootstrap only when importing existing D1 data, then follow [the MongoDB gateway cutover runbook](docs/migrations/mongodb-cutover-runbook.md). Do not point the Cloudflare Worker directly at MongoDB.

The commands in this guide change remote Cloudflare state and may enable billed
services. Run them from the repository root while signed into the intended
Cloudflare account.

## 1. Install and verify the project

Tableplan requires Node.js 22 or newer.

```bash
node --version
npm ci
npm run check
```

Do not continue until `npm run check` passes.

## 2. Authenticate Wrangler

Authenticate in the browser and confirm the active account:

```bash
npx wrangler login
npx wrangler whoami
```

If you have access to multiple Cloudflare accounts, record the account ID shown
by `whoami` and confirm that it is the account where Tableplan should run.

## 3. Enable the required Cloudflare products

The preview configuration in `wrangler.jsonc` uses:

- Workers
- D1
- R2
- Queues
- Workers AI
- Durable Objects
- Workflows
- Browser Rendering
- Email Sending

Enable these products for the selected account before deploying. Email Sending
also requires a verified sender domain. Configure its SPF, DKIM, and DMARC
records before setting `EMAIL_MODE` to `cloud` for real delivery.

Private recipe ingestion requires R2, Workflows, Durable Objects, Workers AI,
and an OpenRouter API key. PDF generation requires Browser Rendering. Shopping
list and household invitation email require Email Sending and Queues.

## 4. Provision preview storage and queues

Create resources dedicated to preview:

```bash
npx wrangler d1 create meal-planner-preview --env preview --binding DB --update-config
npx wrangler r2 bucket create meal-planner-private-recipes-preview
npx wrangler queues create tableplan-email-preview
npx wrangler queues create tableplan-email-preview-dlq
```

If D1 data must remain within the European Union, create the database with:

```bash
npx wrangler d1 create meal-planner-preview --jurisdiction eu --env preview --binding DB --update-config
```

Use only one of the two D1 creation commands. Copy the database UUID printed by
Wrangler and replace the preview placeholder in `wrangler.jsonc`:

```json
"database_id": "11111111-1111-1111-1111-111111111111"
```

Keep the binding name `DB` and database name `meal-planner-preview` unchanged.
The R2 and Queue names created above already match the preview bindings in
`wrangler.jsonc`.

The `RecipeIngestionAgent` Durable Object and `recipe-ingestion-preview`
Workflow are created or updated from `wrangler.jsonc` during Worker deployment;
they do not need separate creation commands.

## 5. Choose the preview URL

Use either a `workers.dev` hostname or a custom domain. The URL must be fixed
before testing authentication or emailed links.

### Option A: workers.dev

Find the account's Workers subdomain in the Cloudflare dashboard. With the
configured Worker name, the preview URL normally has this form:

```text
https://family-meal-planner-preview.<account-subdomain>.workers.dev
```

For this Cloudflare account, use the deployed preview URL exactly:

```json
"BETTER_AUTH_URL": "https://family-meal-planner-preview.christkv.workers.dev",
"PUBLIC_APP_URL": "https://family-meal-planner-preview.christkv.workers.dev"
```

For a different Cloudflare account, replace `christkv` with that account's
`workers.dev` subdomain.

### Option B: custom domain

The domain must belong to an active Cloudflare zone. Add a route inside the
`preview` environment in `wrangler.jsonc`:

```json
"routes": [
  {
    "pattern": "preview.tableplan.example",
    "custom_domain": true
  }
]
```

Then configure:

```json
"BETTER_AUTH_URL": "https://preview.tableplan.example",
"PUBLIC_APP_URL": "https://preview.tableplan.example"
```

Replace `preview.tableplan.example` with the real hostname. Cloudflare creates
the DNS record and TLS certificate when the custom domain is deployed.

## 6. Configure preview email and model settings

Replace the example sender in the preview environment with an address from the
verified Email Sending domain:

```json
"EMAIL_FROM": "Tableplan <shopping@your-domain.example>"
```

Update the matching `allowed_sender_addresses` entry under `send_email`.

Review these non-secret preview settings in `wrangler.jsonc`:

- `RECIPE_EXTRACTION_PROVIDER`
- `OPENROUTER_TEXT_MODEL`
- `OPENROUTER_TEXT_FALLBACK_MODELS`
- `OPENROUTER_VISION_MODEL`
- `OPENROUTER_VISION_FALLBACK_MODELS`
- `OPENROUTER_BASE_URL`
- `PDF_MODE`
- `EMAIL_MODE`

The configured NVIDIA `:free` text and vision models use providers that may log
or train on recipe content. In OpenRouter Settings > Privacy, allow training for
free-model providers and make sure no account or API-key guardrail enforces ZDR
for this key. Request-level `zdr: false` cannot override account-wide ZDR.

Do not store provider keys or OAuth secrets in `wrangler.jsonc`.

## 7. Store preview secrets

Create a unique Better Auth secret of at least 32 random bytes and store it
interactively:

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env preview
```

If the application is connected to Better Auth Dash, store the API key shown
by the Dash project wizard. The Dash route is registered even before this value
exists so onboarding can discover it, but ownership verification succeeds only
when the Worker and MongoDB gateway both use the exact key issued by the wizard:

```bash
npx wrangler secret put BETTER_AUTH_API_KEY --env preview
```

If `RECIPE_EXTRACTION_PROVIDER` is `openrouter`, add its key:

```bash
npx wrangler secret put OPENROUTER_API_KEY --env preview
```

Google sign-in is optional. If it is enabled, create a separate preview OAuth
client and store both values:

```bash
npx wrangler secret put GOOGLE_CLIENT_ID --env preview
npx wrangler secret put GOOGLE_CLIENT_SECRET --env preview
```

Register this exact authorized redirect URI in the Google OAuth client:

```text
https://family-meal-planner-preview.christkv.workers.dev/api/auth/callback/google
```

For a different Cloudflare account or a custom preview domain, replace the
origin with the hostname configured in Step 5. Do not use a wildcard callback
URL and do not reuse production OAuth credentials.

## 8. Review the preview configuration

Before applying migrations, confirm that:

- The preview D1 UUID is no longer `11111111-1111-1111-1111-111111111111`.
- `BETTER_AUTH_URL` and `PUBLIC_APP_URL` are the same real HTTPS origin.
- The R2 bucket and both Queue names match the resources that were created.
- `EMAIL_FROM` and `allowed_sender_addresses` use the verified sender.
- Preview and production do not share databases, buckets, queues, or secrets.
- No secret value has been added to a tracked file.

Regenerate the Cloudflare binding types after changing bindings:

```bash
npm run cf-typegen
```

## 9. Apply preview database migrations

Run the quality gate again, then apply all pending migrations to the remote
preview D1 database:

```bash
npm run check
npm run db:migrate:preview
```

Read the Wrangler confirmation carefully and verify that it names
`meal-planner-preview` before approving the remote mutation.

## 10. Deploy preview

Deploy the React Router application and Worker:

```bash
npm run deploy:preview
```

This script selects the preview Cloudflare environment while building, then
deploys the flattened build configuration:

```bash
CLOUDFLARE_ENV=preview npm run build
wrangler deploy
```

Do not replace this with `wrangler deploy --env preview`. The Cloudflare Vite
plugin selects environments at build time, and `--env` has no effect on the
already-generated deployment configuration.

Record the deployed URL and confirm that it exactly matches
`BETTER_AUTH_URL` and `PUBLIC_APP_URL`. If the URL differs, correct both values
and deploy again before testing authentication or generated links.

## 11. Deploy MongoDB storage (recommended target)

MongoDB is accessed through the separately deployed regional gateway, which owns a bounded connection pool and also hosts Better Auth. The sequence is:

1. Provision a transaction-capable MongoDB deployment and three credentials (gateway, importer, administrator).
2. Deploy `Dockerfile.gateway` with a hard instance cap near MongoDB.
3. Run `npm run gateway:migrate -- --atlas-search` with the administrator credential.
4. Run `npm run import:mongodb -- data/recipes_ingredients.csv --batch-size 500` with the importer credential.
5. Store `MONGODB_GATEWAY_URL` and `MONGODB_GATEWAY_SERVICE_TOKEN` as Cloudflare secrets.
6. Rehearse the D1 snapshot/load/verify process.
7. Use `MIGRATION_MAINTENANCE_MODE=true` for the final frozen export, then change `STORAGE_BACKEND` to `mongodb-gateway`.
8. Verify `/api/auth/dash/validate`, sign-in, search, private data, ingestion, sharing, and email before reopening writes.

The exact commands, Better Auth Create Project values, rollback boundary, connection-budget calculation, and retirement gate are in [docs/migrations/mongodb-cutover-runbook.md](docs/migrations/mongodb-cutover-runbook.md). Keep the same `BETTER_AUTH_SECRET` and `BETTER_AUTH_API_KEY` on the application Worker and gateway. Use the public application URL—not the gateway URL—as the Better Auth and Dash base URL. A manual unauthenticated request to `/api/auth/dash/validate` should return 401 once the route exists; the Dash wizard supplies the signed bearer token needed for a successful validation.

## 12. Verify preview

Start with the health endpoint:

```bash
curl -fsS https://<preview-origin>/api/v1/health
```

Then complete these smoke tests:

1. Create an email/password account and sign in again.
2. Complete Google sign-in if it is configured.
3. Search for and open a known recipe.
4. Create a meal plan and generate a shopping list.
5. Generate meal-plan, shopping-list, recipe, and combined PDFs.
6. Send a shopping list email and open its link in a signed-out browser.
7. Toggle a shared shopping item, revoke the link, and confirm access ends.
8. Invite another household account and complete its single-use setup link.
9. Paste and publish a private text recipe.
10. Upload an image and a document, review the extracted drafts, and publish
    them.
11. Confirm a different household cannot access private recipes or artifacts.
12. Exercise a scoped API key and the MCP endpoint if those integrations will
    be used.

Use Cloudflare Worker logs, Queue status, and Workflow instances to diagnose
failures. Do not enable verbose logging permanently in a deployed environment.

## 13. Import recipe data when required

Database migrations create the schema but do not load the full recipe catalog.
Follow the step-by-step **Full Catalog Import to Preview** procedure in
`docs/operations/recipe-import.md`. Stage, review, and export the catalog before
running the remote mutation.
Only after reviewing its QA report, apply the generated SQL to preview:

```bash
npm run import -- apply-remote .import/sql --env preview --confirm
```

Keep catalog import separate from schema migration and application deployment.

## 14. Provision production resources

Proceed only after preview has passed the smoke tests. Create production
resources that are separate from preview:

```bash
npx wrangler d1 create meal-planner-production --env production --binding DB --update-config
npx wrangler r2 bucket create meal-planner-private-recipes-production
npx wrangler queues create tableplan-email-production
npx wrangler queues create tableplan-email-production-dlq
```

Use `--jurisdiction eu` on the production D1 creation command if required.
Replace the production D1 placeholder in `wrangler.jsonc`:

```json
"database_id": "22222222-2222-2222-2222-222222222222"
```

Configure the real production domain, `BETTER_AUTH_URL`, `PUBLIC_APP_URL`, email
sender, models, and an optional production custom-domain route. Use a separate
Google OAuth client with this callback:

```text
https://<production-origin>/api/auth/callback/google
```

## 15. Store production secrets

Use new values rather than copying preview secrets:

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env production
npx wrangler secret put OPENROUTER_API_KEY --env production
npx wrangler secret put GOOGLE_CLIENT_ID --env production
npx wrangler secret put GOOGLE_CLIENT_SECRET --env production
```

The Google commands may be omitted when Google sign-in is disabled.

## 16. Migrate and deploy production

After reviewing the complete production configuration:

```bash
npm run check
npm run db:migrate:production
npm run deploy:production
```

Verify the production health endpoint and repeat the critical authentication,
authorization, planning, PDF, email, upload, and sharing smoke tests.

Do not combine production schema migration, full catalog replacement, and
application deployment into a single unreviewed operation. Follow
`docs/operations/recipe-import.md` for the production catalog release.

## 17. Ongoing deployments

Once initial provisioning is complete, normal releases use the existing
resources:

Preview:

```bash
npm run check
npm run db:migrate:preview
npm run deploy:preview
```

Production, after preview approval:

```bash
npm run check
npm run db:migrate:production
npm run deploy:production
```

Treat `wrangler.jsonc` as the source of truth for non-secret Worker
configuration. Store remote secrets with Wrangler and local-only secrets in the
ignored `.dev.vars` file.

## Troubleshooting Better Auth preview connectivity

If sign-in reports that it could not connect to the server, verify the deployed
Worker before changing application code:

```bash
curl -fsS https://family-meal-planner-preview.christkv.workers.dev/api/v1/health
curl -i https://family-meal-planner-preview.christkv.workers.dev/api/auth/get-session
npx wrangler versions view <version-id> --env preview --json
```

In the version output, confirm that `BETTER_AUTH_URL` and `PUBLIC_APP_URL`
exactly match the browser origin. If Google sign-in is enabled, confirm that
both `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` appear as `secret_text`
bindings. Better Auth does not register the Google provider when either binding
is absent; add both secrets and deploy preview again.

## Related documentation

- `docs/operations/cloudflare-deployment.md`
- `docs/operations/recipe-import.md`
- `docs/operations/private-recipe-ingestion.md`
- `docs/operations/pdf-email-public-checklists.md`
- [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/)
- [Cloudflare Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
- [Better Auth Google provider](https://better-auth.com/docs/authentication/google)
