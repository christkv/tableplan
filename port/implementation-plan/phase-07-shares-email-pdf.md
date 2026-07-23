# Phase 07 — Public Shares, Email, and PDF

## Objective

Port public shopping-share exchange, outbound email workflows, and recipe/plan/shopping PDF
exports with secure token handling, durable retries, and verified document output.

## Scope

- Shopping share create/exchange/cookie/view/revoke/expire.
- Invitation and shopping email delivery.
- Recipe, plan, shopping, and combined PDF exports.
- `/shared/shopping` and `/shared/shopping/:shareId`.
- Safe filenames, cache headers, and download authorization.

## Mandatory decisions before implementation

- [ ] Select email provider/SMTP adapter and document sandbox/test credentials.
- [ ] Decide how a raw share/invitation token needed by a retry is represented: avoid
      persistence where possible; otherwise use a purpose-bound encrypted short-lived secret.
- [ ] Select pinned Chromium in the runtime image or a dedicated PDF service.
- [ ] Define email and PDF retention, maximum size/time/page count, and provider outage
      behavior.
- [ ] Define public-share cookie lifetime and SameSite behavior for actual link flows.

## Workstream 1: public share security

- [ ] Map existing `shopping_list_shares` records while preserving IDs and compatible token
      hashes.
- [ ] Generate high-entropy raw tokens and store only a strong hash.
- [ ] Implement create, exchange, view, revoke, expire, and optional refresh rules.
- [ ] Bind an exchanged public principal to the correct share ID and allowed operation set.
- [ ] Ensure a cookie for one share cannot read another share by changing the URL.
- [ ] Define whether list changes are live, snapshotted, or versioned and match the baseline.
- [ ] Apply rate limits to token exchange without making valid links unusable.
- [ ] Use no-store and referrer controls where raw token URLs or exchanged content could leak.

## Workstream 2: email delivery

- [ ] Keep `email_deliveries` as the durable delivery/idempotency state machine.
- [ ] Publish delivery jobs through the Phase 06 job engine.
- [ ] Implement `EmailSender` with provider message ID, timeouts, retry classification, and a
      local capture adapter.
- [ ] Render invitation and shopping-share email from versioned templates.
- [ ] Prevent retries after an accepted provider response through state/idempotency keys.
- [ ] Protect recipient addresses and message content in logs/metrics/traces.
- [ ] Handle bounce/complaint webhooks only if required by the selected provider; verify
      signatures and make webhook handling idempotent.
- [ ] Add rate and abuse limits for user-triggered sending.

## Workstream 3: PDF rendering

- [ ] Define typed export view models in application code; do not render persistence
      documents.
- [ ] Port HTML/CSS templates for recipe, plan, shopping, and combined output.
- [ ] Render through pinned Chromium with no arbitrary external network access.
- [ ] Bound navigation/render timeout, pages, memory, payload, and concurrent render jobs.
- [ ] Escape all user-controlled values and permit only known-safe asset URLs.
- [ ] Preserve A4/Letter and portrait/landscape behavior where currently supported.
- [ ] Add `Content-Type`, safe RFC-compatible filename, `Content-Disposition`, and no-store
      headers.
- [ ] Decide synchronous versus queued generation per document size; expose a stable download
      contract.
- [ ] Do not download a browser binary at application startup.

## Workstream 4: MVC and frontend

- [ ] Complete share, exchange, public-list, email, and export OpenAPI schemas.
- [ ] Keep raw token exchange separate from authenticated share management responses.
- [ ] Port public share landing/exchange and list routes.
- [ ] Add explicit expired, revoked, wrong-share, unavailable, and offline states.
- [ ] Add authenticated share/email controls to the shopping page.
- [ ] Add export controls and accessible progress/failure behavior.
- [ ] Ensure SPA fallback does not intercept actual PDF/download responses or failures.

## Testing

### Token and concurrency

- Hash compatibility, entropy policy, expiration, revocation, and replay.
- Cookie/share-ID mismatch and cross-share access.
- Two exchange, revoke, and email claims racing.
- Email worker crash before/after provider acceptance.
- Token redaction in URL logs, request logs, errors, traces, and job payloads.

### Email

- Template snapshots and plain-text/HTML link correctness.
- Idempotency and retry classification.
- Local capture E2E and selected-provider sandbox integration.
- Header injection and unsafe display-value escaping.
- Webhook signature/replay tests if applicable.

### PDF

- Visual regression for representative A4/Letter portrait/landscape outputs.
- Long recipes, many plan items, Unicode, fractions, page breaks, and empty states.
- Authorization and cross-household download attempts.
- HTML injection, blocked external resource, timeout, and renderer outage.
- Load/concurrency test at the configured render limit.

### Browser

- Create link, open in a clean browser, exchange, navigate directly, expire/revoke.
- Email request feedback without duplicate send.
- All export variants download with correct name/type and no-store behavior.

## Observability

- Share create/exchange/reject/revoke outcomes by safe reason.
- Email queue age, attempts, provider latency/result, and dead letters.
- PDF queue/render duration, page count bucket, failures, and saturation.
- No recipient, token, share ID, filename content, or private recipe/list content in labels.

## Deliverables

- Public-share principal and SPA flow.
- Email templates, sender adapter, delivery jobs, and runbook.
- PDF renderer, templates, visual baselines, and capacity limits.
- Updated contracts/generated client.
- Security, concurrency, sandbox-provider, and visual evidence.

## Risks and controls

| Risk | Control |
| --- | --- |
| Retry loses or leaks raw token | Purpose-bound encrypted short-lived secret or token-free workflow |
| Provider success followed by crash duplicates email | Delivery idempotency and accepted-response state |
| Chromium becomes an unbounded dependency | Pinned image/service, semaphore, timeout, resource limits |
| Public cookie is used for another share | Bind principal to share ID and test URL substitution |
| User content executes during rendering | Escaping, network isolation, and safe asset allowlist |

## Exit gate

Phase 07 is complete when tokens are hashed, expiring, revocable, redacted, and share-bound;
email retry tests do not create uncontrolled duplicate delivery; public pages preserve access
rules; and every PDF variant passes visual, security, timeout, and header checks.

## Handoff to Phase 08

Provide public/API/session principal composition, durable outbound work, export endpoints,
provider metrics, and operational failure procedures.

