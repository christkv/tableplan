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

Open the URL printed by the Vite development server. It normally uses
`http://localhost:5173`, but selects the next available port when another server
already occupies that port. HTTP origins on `localhost`, `127.0.0.1`, and `::1`
are trusted on any port only in `APP_ENV=local`. Preview and production continue
to trust only their configured public origin. Cloudflare bindings run through
the local Worker runtime.

## Local Test Account

With the development server running, seed the deterministic local-only account:

```bash
npm run seed:test-user
```

Sign in with either the username or email:

| Field | Value |
| --- | --- |
| Username | `tableplanlocal` |
| Email | `local-test@tableplan.test` |
| Password | `Tableplan-local-2026!` |

The command is idempotent when the account has the documented password and
refuses non-loopback URLs. Set `LOCAL_APP_URL` to the URL printed by Vite when
the development server uses another local port. These credentials are for local
development only and must never be configured in preview or production.

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

Household invitation email uses the same capture mode. Owners invite members in
Settings and receive a local-only setup link in the action result. Open that link
in a signed-out/private browser to create the recipient account and join the
owner's household. See `docs/operations/household-accounts.md`.

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

The normal local provider does not need OpenRouter. For remote extraction testing,
set `RECIPE_EXTRACTION_PROVIDER=openrouter`, add `OPENROUTER_API_KEY`, and choose an
OpenRouter text model with `OPENROUTER_TEXT_MODEL` and a vision-capable
model with `OPENROUTER_VISION_MODEL`. Each operation has an optional
comma-separated `*_FALLBACK_MODELS` chain.

The app must remain usable with local FTS when Workers AI or Vectorize is unavailable. Local development authentication is allowed only when `APP_ENV=local`; it must fail closed in preview and production.

## Console Logging

`LOG_LEVEL` controls Tableplan application logs written to the Worker console:

| Value | Output |
| --- | --- |
| `DEBUG` | Debug, informational, and error events |
| `INFO` | Informational and error events |
| `ERROR` | Error events only |

Local development is configured as `LOG_LEVEL=DEBUG`; preview and production
default to `INFO`. Restart `npm run dev` after changing `.dev.vars` or
`wrangler.jsonc`. Tableplan events start with `[tableplan]` and include a
component and event name. Recipe ingestion logs show request handoff, Agent and
Workflow progress, source conversion, model selection, result counts, and
failures without writing source contents, account identifiers, or credentials.

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
  may print a usage warning. `RECIPE_EXTRACTION_PROVIDER=local` ensures local text
  ingestion does not invoke that binding.
- If OpenRouter reports that no endpoints are available, verify that the chosen
  model supports structured output under no-data-collection and ZDR routing, or
  select a compatible model from the OpenRouter models API. Free endpoints that
  log prompts are not eligible for private recipe extraction and commonly
  produce this error even when the model slug itself is valid.
