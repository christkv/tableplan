# Backup and Restore

MongoDB backups and artifact-store backups are separate consistency domains. Record both
timestamps and retain the mapping between ingestion artifact keys and Mongo documents.

```bash
TABLEPLAN_MONGO_URI=... TABLEPLAN_MONGO_DATABASE=application \
  scripts/backup.sh /secure/backups/2026-07-23

TABLEPLAN_MONGO_URI=... TABLEPLAN_RESTORE_DATABASE=application_restore_20260723 \
  scripts/restore.sh /secure/backups/2026-07-23/tableplan.archive
```

After restore, run schema dry-run, collection/index counts, sampled tenant isolation checks,
recipe search, plan generation, and shopping aggregation. A backup is not considered verified
until this isolated restore drill succeeds and its duration is recorded.

Initial targets pending platform-owner approval: RPO 24 hours and RTO 4 hours.
