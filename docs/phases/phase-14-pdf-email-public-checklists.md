# Phase 14: PDF Exports, Email Delivery, and Public Checklists

**Status (2026-07-17): Implemented locally.** Export models and local print
previews, authenticated routes/UI, public capability checklists, local email
capture, Queue/Email/Browser bindings, REST/MCP contracts, migration, and tests
are implemented. Cloud PDF rendering and outbound email remain preview gates.

Date: 2026-07-17

## Objective

Allow an authenticated user to:

- Download one recipe as a PDF.
- Download one meal plan as a PDF.
- Download one shopping list as a printable PDF with checkboxes.
- Download a combined meal-plan and shopping-list PDF.
- Email the current shopping list to their own account email.
- Open a time-limited checklist from that email without signing in and check
  items while shopping.

The login-free link must not weaken normal recipe, plan, household, or account
authorization. It grants read/check access to one shopping list only.

## Recommended Product Decisions

1. Build one structured export model per document type and render dedicated
   print HTML. Do not print the normal application pages or navigation.
2. Use Cloudflare Browser Rendering to convert trusted HTML to PDF in preview
   and production. The PDF endpoint accepts raw HTML, supports A4 and Letter,
   headers/footers, margins, backgrounds, and tagged PDFs.
3. Keep an HTML print preview available locally. Local design iteration must
   work without Cloudflare credentials; actual PDF bytes can use an optional
   remote Browser Rendering binding or browser Save as PDF.
4. Generate PDFs synchronously for the first release. Add private R2 caching
   only if production metrics show repeated or expensive renders.
5. Restrict Email to me to the authenticated user's account email. Do not
   accept an arbitrary recipient in the UI or API.
6. Use Cloudflare Email Service through a small `EmailSender` adapter in
   production. Cloudflare supports a native Workers email binding. Arbitrary
   recipient sending requires Workers Paid; verified account destinations can
   be sent to without the paid arbitrary-recipient feature.
7. Send email jobs through Cloudflare Queues. The request records/enqueues the
   job and returns promptly; a consumer handles retries and delivery status.
8. A public checklist uses a random capability token, not an authenticated
   session and not a public household/list ID by itself.
9. Store only a SHA-256 token hash and a short diagnostic prefix in D1. Never
   store or log the raw token.
10. Put the raw token in the email URL fragment. Client JavaScript immediately
    removes the fragment, exchanges the token in a POST body, and receives an
    HttpOnly, Secure, SameSite=Strict capability cookie. This avoids sending the
    raw token in the initial URL, referrer, or normal HTTP access logs.
11. Public access is read/check-only. It cannot regenerate a list, inspect
    recipes, read household details, add manual items, or change quantities.
12. Default link lifetime is 14 days, with 3, 7, 14, and 30 day choices. Links
    can be revoked immediately from the authenticated shopping-list screen.
13. Email HTML is a snapshot at send time. The linked checklist reads the live
    shopping-list state and therefore reflects later serving/list refreshes.

## User Flows

### Recipe PDF

1. Open an accessible recipe.
2. Select Download PDF from the recipe actions.
3. The export uses the currently selected servings and measurement system.
4. The browser downloads `recipe-<safe-title>-<servings>-servings.pdf`.

The document contains title, description, yield, measurement system,
ingredients, instructions, tags, and a generated timestamp. Private recipes
remain available only to their owner unless already household-visible.

### Meal Plan PDF

1. Open a week.
2. Select Download PDF.
3. Export the exact plan week, configured meal-section labels/order, recipes,
   servings, notes, and empty cells where useful for writing.

Use landscape A4 or Letter with repeated day headings on page breaks.

### Shopping List PDF

1. Open a generated list.
2. Select Download PDF.
3. Export each item with a clear empty square, quantity, unit, ingredient name,
   unresolved indicator, and optional source recipe names.

Already checked items render with a checked square and subdued text. Print
checkboxes use CSS borders, not font glyphs, so they remain reliable across
PDF fonts and printers.

### Combined PDF

1. Open a plan with a linked shopping list.
2. Select Meal plan + shopping list.
3. Validate that the selected list belongs to that plan.
4. Render the meal-plan pages first, followed by the checklist pages.

Use one landscape page format in the first release. Shopping items can use two
columns in landscape. This avoids PDF binary merging and mixed-orientation
compatibility until there is evidence it is needed.

### Email to Me

1. Open a generated shopping list.
2. Select Email to me.
3. Choose link lifetime and confirm the masked account email.
4. Create or rotate a share capability, record an email-delivery row, and
   enqueue the delivery.
5. Show queued, sent, or failed status and allow retry without creating an
   unbounded number of active links.

Email content includes:

- Plan/list name and date range.
- The current item/quantity list in HTML and plain text.
- A prominent Open checklist link.
- The expiration date and a note that the link can be revoked.

### Login-Free Store Checklist

1. The email opens `/shared/shopping#access=<raw-token>`.
2. The public shell removes the fragment from browser history immediately.
3. It POSTs the token to `/api/public/shopping/exchange`.
4. The server hashes the token, validates active/expiry state, sets a scoped
   capability cookie, and returns the share ID.
5. The clean route `/shared/shopping/<shareId>` loads only list name, dates,
   measurement system, item names, quantities, and checked state.
6. Item toggles use optimistic UI and a list-scoped public mutation endpoint.
7. Expired/revoked links clear the capability cookie and show a neutral access
   expired screen without exposing whether a household or list exists.

## Architecture

### Shared Export Models

Add server-only builders under `src/exports/`:

```text
RecipeExportModel
MealPlanExportModel
ShoppingListExportModel
CombinedPlanExportModel
ExportOptions
  paper: a4 | letter
  measurementSystem: original | metric | us
  selectedServings?
  includeSourceRecipes
  includeCheckedItems
```

Builders perform household/recipe access checks and return plain structured
data. HTML renderers receive only these models. This separates data access,
formatting, HTML, PDF transport, and email composition for focused tests.

Add repository methods that do not currently exist:

- `getMealPlanById(db, householdId, planId)`.
- `getShoppingListById(db, householdId, listId, measurementSystem)`.
- `getShoppingListForPlan(db, householdId, planId, listId?)`.
- `getPublicShoppingList(db, shareId)` with an intentionally reduced shape.

### PDF Renderer Adapter

```ts
interface PdfRenderer {
  render(html: string, options: PdfOptions): Promise<ArrayBuffer>;
}
```

Implementations:

- `CloudflareBrowserPdfRenderer`: production/preview Browser Rendering binding.
- `HtmlPreviewPdfRenderer`: local print-preview response with identical CSS.
- Optional local remote mode for integration tests against Browser Rendering.

Use raw trusted HTML rather than asking the rendering browser to navigate to an
authenticated URL. Escape all recipe/user text through React SSR or a proper
HTML escaper. Do not concatenate unescaped dataset or private recipe content.

PDF responses use:

```text
Content-Type: application/pdf
Content-Disposition: attachment; filename="<safe-name>.pdf"
Cache-Control: private, no-store
X-Content-Type-Options: nosniff
```

Enable print backgrounds, CSS page sizes, tagged output, page numbers, and a
small generated timestamp. Default A4 for metric and Letter for US; always let
the export dialog override paper size.

### Email Adapter and Queue

```ts
interface EmailSender {
  send(message: { to: string; subject: string; html: string; text: string;
    messageId: string }): Promise<{ providerMessageId?: string }>;
}
```

Implementations:

- `CloudflareEmailSender` using the `send_email` Workers binding.
- `CaptureEmailSender` for local development. It returns the rendered preview
  to the authenticated sender and never contacts an external recipient.
- `FakeEmailSender` for tests.

Add an `EMAIL_DELIVERY_QUEUE` producer and consumer. The queue payload contains
only delivery ID and the one raw share URL needed to compose/send the message.
Do not print queue bodies. The D1 row contains metadata and error summaries but
not the raw token or rendered email body.

Use a deterministic RFC Message-ID based on delivery ID. Consumer processing
must claim a pending/retry row before sending, record attempts, and stop after a
bounded retry count with a dead-letter queue or terminal failed state.

### Capability Authentication

Generate 32 cryptographically random bytes and encode as base64url. Store:

- `token_hash = SHA-256(rawToken)`.
- `token_prefix` for support/audit display only.
- Expiration and revocation timestamps.

Every public read/write:

1. Reads the capability cookie.
2. Hashes its raw token.
3. Resolves one active share.
4. Verifies route share ID and item ID belong to that share/list.
5. Applies the operation without accepting household/list ownership from the
   client.

Use constant-time hash comparison where application comparison occurs. Add
`Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, a strict CSP,
`X-Robots-Tag: noindex, nofollow`, no third-party scripts/assets, no analytics,
and an Origin check on exchange/toggle POST requests.

Throttle exchange attempts by IP/token prefix and email sends by user and
household. Initial limits: 5 sends per user per hour and 20 per household per
day. Audit create, send, access, revoke, expire, and failed toggle events without
recording raw capabilities.

## Data Model

Add a migration with:

```sql
CREATE TABLE shopping_list_shares (
  id TEXT PRIMARY KEY,
  shopping_list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  token_prefix TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE email_deliveries (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  shopping_list_id TEXT NOT NULL REFERENCES shopping_lists(id) ON DELETE CASCADE,
  share_id TEXT NOT NULL REFERENCES shopping_list_shares(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,
  last_error_message TEXT,
  queued_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Add indexes for list shares, active expiry lookup, user send-rate lookup, and
pending email status. Add status checks for `pending`, `queued`, `sending`,
`sent`, and `failed`.

Do not store PDFs in D1. If caching is later enabled, use a separate private R2
bucket with a short lifecycle and keys derived from entity ID plus an export
version hash. Never make the bucket public.

## Routes and Contracts

### Authenticated PDF/API Routes

| Method | Path | Scope | Behavior |
| --- | --- | --- | --- |
| GET | `/api/v1/recipes/{recipeId}/pdf` | `recipes:read` | Recipe PDF with servings/unit/paper options |
| GET | `/api/v1/meal-plans/{planId}/pdf` | `plans:read` | One plan PDF |
| GET | `/api/v1/shopping-lists/{listId}/pdf` | `shopping:read` | Printable checklist PDF |
| GET | `/api/v1/meal-plans/{planId}/combined.pdf?shoppingListId=` | `plans:read`, `shopping:read` | Linked plan/list bundle |
| POST | `/api/v1/shopping-lists/{listId}/shares` | `shopping:write` | Create/rotate an expiring capability |
| DELETE | `/api/v1/shopping-lists/{listId}/shares/{shareId}` | `shopping:write` | Revoke capability |
| POST | `/api/v1/shopping-lists/{listId}/email` | `shopping:write` | Send to authenticated user's account email |
| GET | `/api/v1/email-deliveries/{deliveryId}` | `shopping:read` | Read queued/sent/failed status |

PDF endpoints accept bounded `paper`, `measurementSystem`, `servings`, and
include flags. Use existing API-key scopes; do not create broad export/share
scopes in the first release. Add OpenAPI definitions and skill references.

### Public Routes

| Method | Path | Authentication | Behavior |
| --- | --- | --- | --- |
| GET | `/shared/shopping` | none | Static token-exchange shell; no list data |
| POST | `/api/public/shopping/exchange` | fragment token in body | Set capability cookie and return share ID |
| GET | `/shared/shopping/{shareId}` | capability cookie | Mobile checklist shell |
| GET | `/api/public/shopping/{shareId}` | capability cookie | Reduced live list JSON |
| PATCH | `/api/public/shopping/{shareId}/items/{itemId}` | capability cookie | Toggle checked state only |
| POST | `/api/public/shopping/logout` | capability cookie | Clear local capability cookie |

Public endpoints must never accept API keys or normal session cookies as a
substitute for the share capability. This keeps their authorization behavior
explicit and independently testable.

## UI Work

### Recipe Detail

- Add a Download button with PDF icon.
- Export dialog: servings, current measurement system, A4/Letter.
- Preserve selected serving scale.

### Meal Plan

- Add an Export menu: Meal plan PDF and Meal plan + shopping list PDF.
- For combined export, select the latest list linked to that plan or direct the
  user to generate one first.
- Keep configured custom meal-section labels and order.

### Shopping List

- Add an Export menu: Shopping list PDF and Combined PDF.
- Add Email to me with masked account email and expiration selector.
- Show delivery status, active-link expiry, Copy link, and Revoke controls.
- Do not display the raw link again after leaving the successful action state;
  creating/copying later rotates the capability.

### Public Checklist

- Mobile-first single-column rows with at least 44px toggle targets.
- Show list name, plan date range, quantity, unit, and checked state.
- Use optimistic toggles with rollback and a clear offline/error state.
- Keep the layout usable at 320px and with 200 percent text zoom.
- No app sidebar, account controls, recipe links, household names, or settings.

Offline mutation replay is a follow-up hardening item, not part of the first
release. The first release must detect offline state and retain the last loaded
screen without claiming an unsynchronized check succeeded.

## Phased Implementation

### 14A. Export Models and Print Previews

1. Add by-ID household-scoped plan/list repositories.
2. Define export models and option parsers.
3. Build recipe, plan, shopping, and combined HTML renderers.
4. Add authenticated development print-preview routes.
5. Add golden HTML tests for long titles, quotes/entities, custom meal sections,
   fractional servings, metric/US units, unresolved ingredients, and page
   breaks.

Exit: every document is correct and printable as HTML locally.

### 14B. PDF Downloads

1. Add the `PdfRenderer` interface and Cloudflare implementation.
2. Add environment bindings/secrets and local preview mode.
3. Implement four authenticated PDF endpoints and UI controls.
4. Add filename/content-header validation and access-isolation tests.
5. Render PDFs in preview, rasterize pages in CI/local QA, and compare page
   count, nonblank pixels, clipping, checkbox visibility, and long-content
   behavior on A4 and Letter.

Exit: all four PDF types download correctly from preview and print cleanly.

### 14C. Public Checklist Capabilities

1. Add share tables, token service, expiry/revocation, and rate limits.
2. Implement fragment exchange and capability cookie middleware.
3. Build reduced public list/toggle repositories and routes.
4. Build the mobile checklist and authenticated share-management controls.
5. Add privacy, cross-household, expiry, revoke, stale-item, CSRF/origin, and
   concurrent-toggle tests.

Exit: a no-login user can check one shared list and cannot access anything else.

### 14D. Email Delivery

1. Add delivery table, provider adapter, email templates, and account-email-only
   action.
2. Add Queue producer/consumer, retry state, deterministic Message-ID, and
   delivery status polling.
3. Configure Cloudflare Email Service sender domain, SPF, DKIM, and DMARC.
4. Add local capture mode and provider mocks.
5. Test HTML/plain-text content, live link, expiry copy, duplicate submissions,
   retries, terminal failure, and send-rate limits.

Exit: the user receives a shopping-list email and its checklist link works on a
fresh logged-out mobile browser.

### 14E. Integration and Hardening

1. Add OpenAPI routes and REST/MCP skill documentation.
2. Add API/MCP operations for creating/revoking a share and emailing the
   account user. Do not return PDF binary through MCP; return authenticated
   download URLs or use REST.
3. Add audit events and operational dashboards for PDF errors, queue depth,
   email failures, share exchanges, and public toggle failures.
4. Add scheduled cleanup for expired/revoked shares and old delivery metadata.
5. Complete desktop/mobile browser QA, PDF visual QA, load tests, and a preview
   deployment rehearsal.

Exit: operations and integrations are documented and production gates pass.

## Test Plan

### Unit

- Export option bounds and filename sanitization.
- Quantity formatting and serving scaling in export models.
- HTML escaping for dataset and private recipe text.
- Token generation/hash/expiry/revoke behavior.
- Public response projection excludes household/private fields.
- Email HTML/text rendering and account-recipient enforcement.

### Integration

- Owner can export accessible private/household/catalog recipes.
- Another household receives 404 for every private PDF/share resource.
- Combined export rejects an unrelated shopping list.
- Checked state appears correctly in PDF and email snapshot.
- Public token can read/toggle only its list.
- Expired/revoked/invalid tokens return the same neutral response.
- Serving changes refresh linked quantities visible through an existing share.
- Queue retries do not create a new active share or unbounded deliveries.

### PDF Visual QA

- A4 and Letter, portrait and landscape.
- One-page and multi-page recipe.
- Seven-day plan with up to eight custom meal sections.
- Shopping list with 0, 1, 40, and 150 items.
- Long unbroken ingredient/title text and non-ASCII user recipe text.
- Checkbox border visibility in grayscale and at normal printer resolution.
- Header/footer, page numbers, margins, no blank trailing page, and no clipped
  rows.

### Browser and Email QA

- Public checklist at 320x568, 390x844, and desktop.
- 200 percent text zoom and keyboard/screen-reader operation.
- Fresh browser with no login/session cookies.
- Link opened after normal account logout.
- Link opened on a second device, then revoked from the authenticated app.
- Email rendering in Gmail web/mobile, Apple Mail, and Outlook web.

## Deployment and Operations

Add environment-specific configuration for:

- Browser Rendering binding or API access.
- `EMAIL` send binding and approved sender domain.
- `EMAIL_DELIVERY_QUEUE` and dead-letter queue.
- `PUBLIC_APP_URL`; never derive emailed links from an untrusted Host header.
- Local `EMAIL_MODE=capture` and `PDF_MODE=html-preview`.

Deployment order:

1. Apply D1 migration.
2. Provision preview Browser Rendering, Email Service, Queue, and sender DNS.
3. Deploy preview and run PDF/public/email acceptance tests.
4. Configure production bindings and secrets.
5. Apply production migration.
6. Deploy production with email sending initially limited to internal accounts.
7. Validate deliverability and public-link revocation before general release.

Operational metrics:

- PDF requests, latency, page count, bytes, and render failures by type.
- Email queued/sent/failed/retried counts and provider latency.
- Active/expired/revoked shares and exchange failures.
- Public list reads/toggles and rejected cross-list item IDs.
- Rate-limit rejections without token or email values in logs.

## Acceptance Criteria

- Each of the four requested PDF types downloads with correct current data.
- Recipe PDFs honor selected servings and measurement system.
- Shopping PDFs contain visible printable checkboxes for every included item.
- Combined PDFs contain only a linked plan and shopping list.
- Email goes only to the authenticated user's account email and contains HTML
  plus plain text.
- The email link works without login in a fresh browser.
- The public checklist can only read and toggle one list.
- Link expiry and revocation take effect immediately.
- Raw share tokens never appear in D1, application logs, analytics, referrers,
  or normal route URLs.
- Local print/email preview modes work without production credentials.
- Preview PDF visual QA, cross-household authorization tests, queue retry tests,
  and the full project quality gate pass.

## Non-Goals

- Emailing arbitrary recipients or sharing address books.
- Public recipe or meal-plan links.
- Editing quantities, regenerating lists, or adding items from the public link.
- PDF editing, annotations, digital signatures, or password-protected PDFs.
- Email attachments in the first release.
- Offline toggle synchronization in the first release.
- Permanent public links.

## Current Platform References

- Cloudflare Browser Rendering can generate PDF from a URL or raw HTML and
  supports paper format, margins, headers/footers, backgrounds, CSS page size,
  and tagged output:
  https://developers.cloudflare.com/api/resources/browser_rendering/subresources/pdf/methods/create/
- Cloudflare Browser Run documents PDF generation through REST or Workers
  bindings, with no API token needed for the binding path:
  https://developers.cloudflare.com/browser-run/quick-actions/pdf-endpoint/
- Cloudflare Email Service exposes outbound email through a Workers binding:
  https://developers.cloudflare.com/email-service/api/send-emails/workers-api/
- Cloudflare Email Service pricing distinguishes verified destinations from
  arbitrary recipients, which require Workers Paid:
  https://developers.cloudflare.com/email-service/platform/pricing/
- Cloudflare Queues provides asynchronous delivery, retries, delays, batching,
  and dead-letter handling for the email pipeline:
  https://developers.cloudflare.com/queues/
