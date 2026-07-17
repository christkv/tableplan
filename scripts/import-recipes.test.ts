import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { exportSql, importRecipes, writeQaReport } from "./import-recipes";

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("recipe import pipeline", () => {
  it("imports, reports, and exports a deterministic fixture", async () => {
    const directory = mkdtempSync(join(tmpdir(), "meal-planner-import-"));
    temporaryDirectories.push(directory);
    const database = join(directory, "stage.sqlite");
    const summary = await importRecipes(resolve("scripts/fixtures/recipes-small.csv"), database);
    expect(summary).toMatchObject({ rowsSeen: 3, rowsImported: 2, rowsRejected: 1 });

    const db = new DatabaseSync(database, { readOnly: true });
    expect(db.prepare("SELECT COUNT(*) count FROM recipes").get()).toMatchObject({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) count FROM recipe_search_fts WHERE recipe_search_fts MATCH 'tomato'").get()).toMatchObject({ count: 1 });
    expect(db.prepare("SELECT status FROM import_runs").get()).toMatchObject({ status: "completed" });
    expect(db.prepare("SELECT reason_code FROM import_issues WHERE reason_code = 'duplicate_source_id'").get()).toMatchObject({ reason_code: "duplicate_source_id" });
    db.close();

    const reportPath = writeQaReport(database, join(directory, "report"));
    expect(JSON.parse(readFileSync(reportPath, "utf8")).counts.recipes).toBe(2);
    const sqlPath = await exportSql(database, join(directory, "sql"));
    const sql = readFileSync(sqlPath, "utf8");
    expect(sql).toContain("INSERT INTO recipes");
    expect(sql).toContain("ON CONFLICT (id) DO UPDATE SET");
    expect(sql).not.toContain("INSERT OR REPLACE");
    expect(sql).toContain("INSERT INTO recipe_search_fts");
  });

  it("keeps the earliest source row when a deterministic sample contains duplicate IDs", async () => {
    const directory = mkdtempSync(join(tmpdir(), "meal-planner-sample-"));
    temporaryDirectories.push(directory);
    const database = join(directory, "sample.sqlite");

    await importRecipes(resolve("scripts/fixtures/recipes-small.csv"), database, { sample: true, rows: 3 });

    const db = new DatabaseSync(database, { readOnly: true });
    expect(db.prepare("SELECT name FROM recipes WHERE source_id = '42'").get()).toMatchObject({ name: "Tomato Toast" });
    db.close();
  });
});
