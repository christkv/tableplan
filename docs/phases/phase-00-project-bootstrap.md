# Phase 0: Project Bootstrap

## Objective

Create a minimal full-stack application that runs locally using Cloudflare-compatible bindings and can deploy to an isolated preview environment. This phase proves the development loop before product behavior is added.

## Dependencies

None.

## Deliverables

- React Router full-stack application using TypeScript and the Cloudflare Vite plugin.
- Tailwind CSS and shadcn/ui configured with a small shared component set.
- Cloudflare Worker entrypoint and environment-specific `wrangler.jsonc` configuration.
- Local, preview, and production binding names for D1, Vectorize, Workers AI, Queues, and optional R2.
- App shell with desktop sidebar, mobile navigation, and placeholder routes for Plan, Recipes, Favorites, Shopping, and Settings.
- Vitest, type checking, linting, formatting, and build scripts.
- Architecture decision records for runtime parity, domain boundaries, and external agent surfaces.

## Implementation Sequence

1. Initialize the React Router Cloudflare project and pin runtime/toolchain versions.
2. Add Tailwind and shadcn/ui; define neutral application tokens and responsive shell primitives.
3. Configure Wrangler environments without creating production resources.
4. Add a typed environment interface for Cloudflare bindings.
5. Add a health loader that reads from a local binding or a bootstrap D1 table.
6. Add CI commands for typecheck, tests, and build.
7. Document local setup and secret handling in the repository README.

## Repository Baseline

```text
app/
  components/
  features/
  lib/
  routes/
src/
  domain/
  db/
workers/
  app.ts
migrations/
scripts/
docs/decisions/
```

Expected commands:

```bash
npm run dev
npm run typecheck
npm test
npm run build
npm run db:migrate:local
```

## Verification

- Unit test the environment/config parser.
- Build using the Worker runtime target, not only a browser bundle.
- Run a local smoke test for the home route and health endpoint.
- Deploy to preview and verify static assets, navigation, and one binding read.
- Check narrow mobile and desktop layouts for overflow and navigation usability.

## Acceptance Criteria

- A new developer can install dependencies and start the app from documented commands.
- `npm run typecheck`, `npm test`, and `npm run build` pass.
- The preview Worker serves the same placeholder routes as local development.
- Missing optional cloud services degrade to an explicit disabled state during local development.
- No secrets, generated databases, or data artifacts are tracked.

## Non-Goals

- Real authentication or application schema.
- Recipe import or search.
- Final visual design.
- Provisioning production data resources.

## Exit Artifact

A deployable application skeleton and a reliable local feedback loop that all later phases can extend.
