# Production Cutover and Rollback

Production cutover is intentionally an operator-controlled phase.

## Preconditions

- Immutable artifact checksum and scan evidence.
- Successful restore rehearsal and clean schema/index dry-run against a recent copy.
- Approved password/session communication, OAuth redirect URI, provider credentials, and on-call.
- Captured old release/configuration and a tested rollback route.

## Cutover

1. Freeze old writes and drain old background work.
2. Take the cutover backup and record counts/checkpoint time.
3. Run additive migrations and verify Atlas Search separately.
4. Deploy Spring Boot with jobs disabled and run smoke tests.
5. Shift traffic; then enable one job worker after API health is stable.
6. Reconcile users, households, recipes, plans, shopping lists, jobs, and sampled invariants.

## Rollback

Stop Spring writes/job claims, capture evidence, confirm the migration ledger is backward
compatible, restore the captured old release, and reconcile external calls before reopening
writes. Never roll schema backward without a separately reviewed migration.

The old runtime is retired only after the approved observation window, stable metrics, a fresh
post-cutover restore test, and explicit platform/product sign-off.
