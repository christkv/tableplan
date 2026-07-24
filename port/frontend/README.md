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

For split hot reload, configure the root `.env` with the browser-visible origin:

```dotenv
TABLEPLAN_PUBLIC_ORIGIN=http://localhost:5173
SPRING_SECURITY_OAUTH2_CLIENT_REGISTRATION_GOOGLE_REDIRECT_URI=http://localhost:5173/login/oauth2/code/google
TABLEPLAN_SESSION_COOKIE_SECURE=false
```

Run `./gradlew :backend:bootRun` from the repository root and `npm run dev` here, then open
only `http://localhost:5173`. Vite proxies `/api`, `/mcp`, `/oauth2`, and `/login/oauth2` to
Spring Boot. Its port is strict because the OAuth callback must exactly match the URI
registered with Google.

For packaged local testing, use `http://localhost:9090` for both origins and open Spring Boot
directly.

The normal Gradle build runs the frontend tests and build before packaging:

```bash
./gradlew check :backend:bootJar
./scripts/check-performance-budgets.sh
```
