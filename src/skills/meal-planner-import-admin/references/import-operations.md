# Import Command Reference

All generated data belongs under `.import/`, which is ignored by Git.

```bash
npm run import -- analyze data/recipes_ingredients.csv
npm run import -- sample data/recipes_ingredients.csv --rows 5000 --out .import/sample.sqlite
npm run import -- stage data/recipes_ingredients.csv --out .import/stage.sqlite
npm run import -- normalize .import/stage.sqlite
npm run import -- qa .import/stage.sqlite --out .import/reports/full
npm run import -- export-sql .import/stage.sqlite --out .import/sql
npm run import -- apply-local .import/sql
npm run import -- apply-remote .import/sql --env preview --confirm
```

The source hash must remain constant across stage, QA, and export. A valid run
must reconcile `rowsSeen = rowsImported + rowsRejected`; duplicate source IDs
are rejected and reported. Review issue classes, unresolved ingredients,
servings outliers, foreign keys, and FTS counts before application.

Remote apply requires the explicit `--confirm` flag and configured Wrangler
resources. Production also requires a reviewed preview run, license/provenance
approval, capacity review, and a recovery snapshot or rebuild procedure.
