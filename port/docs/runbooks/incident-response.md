# Incident Response

- Readiness failure: remove the replica from traffic; check Mongo selection and pool pressure.
- Atlas Search outage: recipe ID/list reads remain available; text search may fail explicitly.
- Job backlog: disable claims, inspect safe job metadata, repair the dependency, then replay.
- OAuth outage: preserve credential login; do not weaken account-link rules.
- Email outage: deliveries remain queued/retryable; never reconstruct tokens from logs.
- Artifact/provider outage: retain ingestion state and retry; do not publish partial drafts.
- Suspected token leak: revoke sessions/API keys/shares, rotate affected delivery credentials,
  preserve audit evidence, and notify the security owner.

Never paste raw credentials, session cookies, API keys, share tokens, invitation tokens, recipe
source payloads, or recipient content into tickets, logs, or metrics.
