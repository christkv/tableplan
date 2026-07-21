# PDF, Email, and Public Checklist Operations

Date: 2026-07-17

## Local Development

Apply the MongoDB schema definitions and run the application:

```bash
npm run gateway:migrate:local
npm run dev
```

Local defaults in `wrangler.jsonc` are:

```text
PDF_MODE=html-preview
EMAIL_MODE=capture
PUBLIC_APP_URL=http://127.0.0.1:5173
```

Recipe, plan, shopping-list, and combined export endpoints return dedicated
print HTML locally. Use browser Print / Save as PDF to inspect pagination. The
same renderers are passed to Browser Rendering in preview and production.

`Email to me` performs the complete database/share workflow in capture mode but
does not contact an email provider. The shopping screen displays the newly
created checklist URL once. Open it in a private browser to test fragment
exchange, the capability cookie, item toggles, expiration, and revocation.

## Cloudflare Resources

Each cloud environment requires:

- Browser Rendering binding `BROWSER`.
- Email Service send binding `EMAIL`.
- Queue producer `EMAIL_DELIVERY_QUEUE` and matching consumer.
- A dead-letter Queue.
- Current MongoDB collections, validators, and indexes from `npm run gateway:migrate`.
- A verified `EMAIL_FROM` domain and fixed `PUBLIC_APP_URL`.

Provision the queues using the commands in `cloudflare-deployment.md`. Browser
Rendering and Email Service must be enabled for the account. Replace all example
domains before deployment, then regenerate bindings with `npm run cf-typegen`.

## Export Behavior

Authenticated UI sessions and scoped API keys can call:

```text
GET /api/v1/recipes/{recipeId}/pdf
GET /api/v1/meal-plans/{planId}/pdf
GET /api/v1/shopping-lists/{listId}/pdf
GET /api/v1/meal-plans/{planId}/combined.pdf?shoppingListId={listId}
```

Supported query options include `paper=a4|letter`,
`measurementSystem=original|metric|us`, recipe `servings`, and shopping-list
include flags. Combined export verifies that the list belongs to the plan.

## Email and Public Links

Email is restricted to the authenticated user's account email. Limits are five
deliveries per user per hour and twenty per household per day. The Queue message
temporarily carries the raw capability because only its SHA-256 hash is stored
in MongoDB. Queue bodies and raw links must never be logged.

The email URL puts the raw capability in the fragment. `/shared/shopping`
removes it from browser history and exchanges it in a POST body for an HttpOnly,
SameSite=Strict cookie. The clean shared route can read and toggle one shopping
list only. It cannot inspect recipes, household data, or change list contents.

Revoke links from the authenticated Shopping screen. Expired and revoked links
return the same neutral response. Public routes set no-store, no-referrer,
noindex, CSP, and frame-denial headers.

## Preview Verification

1. Run `npm run check` and apply the preview migration.
2. Download each export as A4 and Letter; inspect long recipes and large lists.
3. Confirm private/cross-household IDs return 404.
4. Send to the account email and verify both HTML and plain-text content.
5. Open the link in a fresh logged-out browser and toggle several items.
6. Confirm the authenticated list reflects those changes.
7. Revoke the link and verify reads and writes return 410.
8. Inspect Queue retries and the dead-letter Queue with a deliberately invalid
   sender in preview.

Never enable production email until sender DNS and the complete preview flow
have passed.
