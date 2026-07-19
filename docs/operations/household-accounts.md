# Household Accounts

## Local Workflow

Apply migrations and start the app:

```bash
npm run db:migrate:local
npm run dev
```

Sign in as a household owner, open `/settings`, and use **Send invite**. Local
`EMAIL_MODE=capture` sends no external message. Settings shows the single-use
link only in the action result; open it in a signed-out/private browser window.
The recipient enters a name, username, and password and is redirected into the
shared household.

If the email already has a Tableplan account, the join page directs that user to
sign in and returns to the pending invitation. It never resets an existing
password. The authenticated email must match the invitation.
If that account already belongs to another household, Settings shows an active
household selector so the user can switch between memberships.

## Cloud Delivery

Preview and production use the existing `EMAIL_DELIVERY_QUEUE`, `EMAIL`,
`EMAIL_FROM`, `EMAIL_MODE=cloud`, and fixed `PUBLIC_APP_URL` configuration.
The queue consumer dispatches both shopping-list and household-invitation
messages. Invitation links are always built from `PUBLIC_APP_URL`, never the
request Host header. Verify the sender domain and arbitrary-recipient support
before inviting external addresses.

Deploy in this order:

```bash
npm run check
npm run db:migrate:preview
npm run deploy:preview
```

Create an invitation in preview, confirm `delivery_status` reaches `sent`, open
the message in a logged-out mobile browser, finish account setup, and verify that
the recipient sees the inviter's household data. Repeat the link and expect the
unavailable state.

## Lifecycle and Recovery

- Invitations expire seven days after creation.
- Reinviting the same household/email revokes its previous pending link.
- Owners can revoke pending invitations from Settings.
- Cloud delivery failures set `delivery_status=failed` and retain a bounded
  error message. Queue delivery retries up to the configured consumer limit.
- A failed account-creation request leaves the invitation pending. If Better
  Auth created the account before a later membership write failed, sign in with
  that account and retry the same invitation.
- D1 schema changes are forward-fixed; do not roll back migration `0007` by
  dropping membership data.

## Security Checks

- Never paste an invitation link into logs, tickets, analytics, or screenshots.
- D1 must contain only `token_hash` and `token_prefix`, not the raw token.
- Keep `BETTER_AUTH_SECRET` distinct per environment.
- Confirm public join responses include no-store, no-referrer, no-index, CSP,
  and frame-denial headers.
- Do not label or expose restricted/read-only members until every write path
  enforces that policy.
