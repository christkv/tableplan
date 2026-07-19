# Local Development

## Prerequisites

- Node.js 22 or newer. Node.js 24 is the currently tested local runtime.
- npm 11 or newer.
- The source dataset at `data/recipes_ingredients.csv` for import work.
- A Cloudflare account is not required for the core local workflow.

## First Run

```bash
npm install
npm run db:migrate:local
npm run import:sample
npm run dev
```

The Vite development server prints the local URL, normally
`http://localhost:5173` or `http://127.0.0.1:5173`. Both origins are trusted only
in `APP_ENV=local`. Cloudflare bindings run through the local Worker runtime.

Local recipe ingestion accepts pasted text and TXT/Markdown files without a
cloud account. It stores source artifacts in the local R2 emulator and uses the
deterministic parser before opening the review screen. PDF, DOCX, ODT, and image
sources are accepted and retained locally, but extraction returns
`cloud_ai_required`; use preview or an OpenRouter-enabled remote workflow to
exercise those formats. Images use the configured OpenRouter vision model
directly. Workers AI converts PDF/DOCX/ODT files to text before the configured
OpenRouter text model performs structured recipe extraction.

PDF endpoints render the production print layout as HTML when
`PDF_MODE=html-preview`. Open an export and use the browser's Print / Save as PDF
command while iterating locally. Preview and production use Cloudflare Browser
Rendering and return downloadable PDF bytes.

Shopping-list email uses `EMAIL_MODE=capture` locally. The normal action creates
the delivery and public checklist capability, marks the captured delivery sent,
and shows the one-time checklist link in the shopping screen; no external email
is sent. See `docs/operations/pdf-email-public-checklists.md` for the complete
workflow.

Create an email/password account from the sign-in screen. Usernames can be used
for subsequent sign-in. Google sign-in appears only when local Google OAuth
credentials are configured.

## Normal Development Loop

```bash
npm run dev
npm test
npm run typecheck
npm run build
```

Run a single test file with:

```bash
npx vitest run path/to/file.test.ts
```

## Local Configuration

Copy `.dev.vars.example` to `.dev.vars` only when authentication or remote-service credentials are needed. Generate `BETTER_AUTH_SECRET` with at least 32 random bytes. Never commit `.dev.vars`.

The normal local mode does not need OpenRouter. For remote extraction testing,
set `RECIPE_EXTRACTION_MODE=openrouter`, add `OPENROUTER_API_KEY`, and choose an
OpenRouter text model with `RECIPE_TEXT_EXTRACTION_MODEL` and a vision-capable
model with `RECIPE_VISION_EXTRACTION_MODEL`. Each operation has an optional
comma-separated `*_FALLBACK_MODELS` chain.

The app must remain usable with local FTS when Workers AI or Vectorize is unavailable. Local development authentication is allowed only when `APP_ENV=local`; it must fail closed in preview and production.

## Local Database

Apply migrations:

```bash
npm run db:migrate:local
```

Wrangler stores local D1 state under `.wrangler/`. Removing that state destroys the local database, so use a deliberate reset procedure and re-run migrations/import afterward.

Inspect the local database with Wrangler:

```bash
npx wrangler d1 execute DB --local --command "SELECT COUNT(*) AS recipes FROM recipes"
```

## Quality Checks

Before considering a checkpoint complete:

```bash
npm run check
```

`check` runs type generation/type checking, unit/integration tests, and the production build.

## Troubleshooting

- If generated route types are missing, run `npm run typecheck` once; it invokes React Router type generation.
- If D1 reports a missing table, run `npm run db:migrate:local`.
- If recipe pages are empty, run `npm run import:sample` and inspect `.import/reports/sample/`.
- The importer uses Node's built-in SQLite module, which currently prints an
  experimental-module warning during import and importer tests.
- If Cloudflare binding types changed, run `npm run cf-typegen`.
- If a cloud-only binding is unavailable, verify the feature falls back to its documented local mode instead of adding a production credential to browser code.
- Workers AI bindings are remote even when the rest of Wrangler is local and
  may print a usage warning. `RECIPE_EXTRACTION_MODE=local` ensures local text
  ingestion does not invoke that binding.
- If OpenRouter reports that no endpoints are available, verify that the chosen
  model supports structured output under no-data-collection and ZDR routing, or
  select a compatible model from the OpenRouter models API.
