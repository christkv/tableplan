# Household accounts

Household accounts, Better Auth users, memberships, OAuth verification records, and invitation state are stored in MongoDB through the operations gateway. Active Better Auth sessions are stored in the application Worker’s strongly consistent `AuthSessionStoreDO` and are not written to MongoDB.

## Local workflow

Start the existing local MongoDB service, run `npm run gateway:migrate:local`, then start the gateway and app. Sign in as an owner, open `/settings`, and send an invitation. With `EMAIL_MODE=capture`, no external email is sent; open the returned single-use link in a private browser.

Existing accounts are directed to sign in. The authenticated email must match the invitation. A user may belong to multiple households and switch the active household in Settings.

## Cloud workflow

Preview and production use the environment's email Queue and fixed `PUBLIC_APP_URL`. Invitation links are never derived from an untrusted Host header.

Deploy gateway schema changes before the Worker:

```bash
npm run gateway:migrate
npm run check
npm run deploy:preview
```

Test delivery, single use, expiration, revocation, reinvitation, email mismatch, and cross-household isolation.

## Security

- Invitations expire after seven days.
- Reinviting the same household/email revokes the earlier pending link.
- MongoDB stores only token hashes and short diagnostic prefixes, never raw invitation tokens.
- Keep `BETTER_AUTH_SECRET`, gateway tokens, and MongoDB credentials distinct per environment.
- Public join responses must remain no-store/no-referrer/no-index with CSP and frame denial.
