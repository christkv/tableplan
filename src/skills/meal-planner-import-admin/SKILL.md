---
name: meal-planner-import-admin
description: Run, diagnose, and review the Tableplan raw CSV to MongoDB catalog importer, including bounded sample runs, resumable full imports, issue review, and guarded production application.
---

# Tableplan import administration

Read `references/import-operations.md` and `docs/operations/recipe-import.md` before a full import.

1. Verify the source CSV without modifying it.
2. Confirm the exact MongoDB URI and database: `application_local`, `application_preview`, or `application`.
3. Run MongoDB schema/index migration first.
4. Use a bounded local/preview run and review `import_runs` plus `import_issues`.
5. Resume with the same source/run rather than starting an unrelated run after interruption.
6. Exercise UI, REST, MCP, planning, and shopping smoke tests.
7. Require `--allow-production`, backups, capacity approval, and a release record for `application`.

Never edit the source CSV, suppress rejection findings, expose credentials, or run production as a side effect of QA.
