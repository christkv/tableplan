# Import command reference

Local bounded run:

```bash
MONGODB_URI='mongodb://127.0.0.1:27017/?directConnection=true' npm run import -- \
  data/recipes_ingredients.csv --database application_local --limit 5000 --batch-size 500
```

Preview full run:

```bash
MONGODB_URI='<preview-import-uri>' npm run import -- \
  data/recipes_ingredients.csv --database application_preview --batch-size 500
```

Production full run:

```bash
MONGODB_URI='<production-import-uri>' npm run import -- \
  data/recipes_ingredients.csv --database application --batch-size 500 --allow-production
```

Review the source hash, status, checkpoint, imported/rejected counts, issue classes, catalog count, representative documents, and application search. Repeating the same source resumes its deterministic run.
