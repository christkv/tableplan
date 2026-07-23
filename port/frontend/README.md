# Tableplan frontend port

This directory is the complete React/Vite frontend for the Spring Boot port. It is isolated
from the legacy React Router/Cloudflare application in `../../app`: the production build
imports no legacy source files, and Gradle embeds only this directory's `dist` output in the
Spring Boot JAR.

## Page routes

The SPA owns the full captured page-route surface:

- `/`, `/sign-in`, and `/auth/error`
- `/household/join`
- `/recipes`, `/recipes/new`, `/recipes/import/:ingestionId`,
  `/recipes/:recipeId`, and `/recipes/:recipeId/edit`
- `/favorites`, `/plan`, `/shopping`, and `/settings`
- `/shared/shopping` and `/shared/shopping/:shareId`

`/login` and `/register` are compatibility aliases. `src/App.test.tsx` locks the captured
15-route manifest so a route cannot disappear unnoticed.

Page modules are route-split with `React.lazy`; the production build emits no source maps.
The repository-level performance gate caps entry and total JavaScript gzip size and verifies
that the JAR contains exactly the current hashed assets.

## Local development

Use Node 22.22 or newer:

```bash
npm ci
npm test
npm run build
npm run dev
```

Vite proxies `/api` and `/mcp` to the Spring server during development. The normal Gradle
build runs the frontend tests and build before packaging:

```bash
./gradlew check :backend:bootJar
./scripts/check-performance-budgets.sh
```
