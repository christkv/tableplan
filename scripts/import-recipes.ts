#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import { Command } from "commander";
import { parse } from "csv-parse";

import { UNITS } from "../src/domain/quantity/units";
import { parseStringList } from "../src/import/list-parser";
import { parseRecipeRow, type CsvRecipeRow, type ParsedRecipeRow } from "../src/import/recipe-parser";

const TOOL_VERSION = "0.1.0";
const PARSER_VERSION = "0.1.0";

interface ImportOptions {
  rows?: number;
  sample?: boolean;
  applyLocal?: boolean;
}

interface ImportSummary {
  runId: string;
  sourcePath: string;
  sourceHash: string;
  sourceSize: number;
  rowsSeen: number;
  rowsImported: number;
  rowsRejected: number;
  issueCount: number;
  repairedSteps: number;
  unresolvedIngredients: number;
  databasePath: string;
}

interface ScoredRow { score: number; tie: string; row: CsvRecipeRow }

class MaxHeap {
  private values: ScoredRow[] = [];
  constructor(private readonly capacity: number) {}
  private greater(left: ScoredRow, right: ScoredRow) { return left.score > right.score || (left.score === right.score && left.tie > right.tie); }
  add(value: ScoredRow) {
    if (this.capacity <= 0) return;
    if (this.values.length < this.capacity) {
      this.values.push(value); this.up(this.values.length - 1); return;
    }
    if (!this.greater(this.values[0], value)) return;
    this.values[0] = value; this.down(0);
  }
  private up(start: number) {
    let index = start;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.greater(this.values[index], this.values[parent])) break;
      [this.values[index], this.values[parent]] = [this.values[parent], this.values[index]];
      index = parent;
    }
  }
  private down(start: number) {
    let index = start;
    for (;;) {
      const left = index * 2 + 1; const right = left + 1; let largest = index;
      if (left < this.values.length && this.greater(this.values[left], this.values[largest])) largest = left;
      if (right < this.values.length && this.greater(this.values[right], this.values[largest])) largest = right;
      if (largest === index) return;
      [this.values[index], this.values[largest]] = [this.values[largest], this.values[index]];
      index = largest;
    }
  }
  sortedRows() { return this.values.sort((a, b) => a.tie.localeCompare(b.tie)).map((item) => item.row); }
}

function deterministicScore(value: string): number {
  const digest = createHash("sha256").update(value).digest();
  return digest.readUInt32BE(0);
}

async function fileSha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function csvRecords(path: string): AsyncIterable<CsvRecipeRow> {
  return createReadStream(path).pipe(parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    relax_quotes: true,
    relax_column_count: true,
    max_record_size: 5 * 1024 * 1024,
  })) as AsyncIterable<CsvRecipeRow>;
}

function openStaging(path: string): DatabaseSync {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(readFileSync(resolve("migrations/0001_initial.sql"), "utf8"));
  return db;
}

function insertParsedRecipe(db: DatabaseSync, runId: string, rowNumber: number, recipe: ParsedRecipeRow, sourceHash: string) {
  db.prepare(`INSERT OR REPLACE INTO recipes (id, source_id, name, description, servings, serving_size, quality_flags_json, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(recipe.id, recipe.sourceId, recipe.name, recipe.description, recipe.servings, recipe.servingSize, JSON.stringify(recipe.qualityFlags), sourceHash);
  db.prepare("DELETE FROM recipe_steps WHERE recipe_id = ?").run(recipe.id);
  db.prepare("DELETE FROM recipe_ingredients WHERE recipe_id = ?").run(recipe.id);
  db.prepare("DELETE FROM recipe_tags WHERE recipe_id = ?").run(recipe.id);

  const ingredientStatement = db.prepare("INSERT OR IGNORE INTO ingredients (id, canonical_name) VALUES (?, ?)");
  const recipeIngredientStatement = db.prepare(`INSERT INTO recipe_ingredients (id, recipe_id, position, ingredient_id, raw_line, ingredient_text, preparation, quantity_min, quantity_max, unit_id, parse_status, parse_confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const ingredient of recipe.ingredients) {
    if (ingredient.canonicalId) ingredientStatement.run(ingredient.canonicalId, ingredient.canonicalName);
    recipeIngredientStatement.run(ingredient.id, recipe.id, ingredient.position, ingredient.canonicalId, ingredient.rawLine, ingredient.ingredientName, ingredient.preparation, ingredient.quantityMin, ingredient.quantityMax, ingredient.unitId, ingredient.parseStatus, ingredient.parseConfidence);
  }
  const stepStatement = db.prepare("INSERT INTO recipe_steps (id, recipe_id, position, instruction, parse_status) VALUES (?, ?, ?, ?, ?)");
  for (const step of recipe.steps) stepStatement.run(step.id, recipe.id, step.position, step.instruction, step.parseStatus);
  const tagStatement = db.prepare("INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)");
  const recipeTagStatement = db.prepare("INSERT OR IGNORE INTO recipe_tags (recipe_id, tag_id) VALUES (?, ?)");
  for (const tag of recipe.tags) { tagStatement.run(tag.id, tag.name); recipeTagStatement.run(recipe.id, tag.id); }

  const issueStatement = db.prepare(`INSERT INTO import_issues (id, import_run_id, source_recipe_id, row_number, field, severity, reason_code, raw_excerpt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  recipe.issues.forEach((issue, index) => issueStatement.run(`${runId}_${recipe.sourceId}_${rowNumber}_${index}`, runId, recipe.sourceId, rowNumber, issue.field, issue.severity, issue.reasonCode, issue.rawExcerpt));

  db.prepare("DELETE FROM recipe_search_fts WHERE recipe_id = ?").run(recipe.id);
  db.prepare("INSERT INTO recipe_search_fts (recipe_id, name, description, ingredients_text, tags_text, steps_text) VALUES (?, ?, ?, ?, ?, ?)")
    .run(recipe.id, recipe.name, recipe.description, [...recipe.cleanedIngredients, ...recipe.ingredients.map((item) => item.ingredientName)].join(" "), recipe.tags.map((tag) => tag.name).join(" "), recipe.steps.map((step) => step.instruction).join(" "));
}

function seedUnits(db: DatabaseSync) {
  const statement = db.prepare("INSERT OR REPLACE INTO units (id, canonical_name, symbol, dimension, to_base_factor, system) VALUES (?, ?, ?, ?, ?, ?)");
  for (const unit of UNITS) statement.run(unit.id, unit.name, unit.symbol, unit.dimension, unit.toBase, unit.system);
}

async function selectSample(path: string, rows: number): Promise<{ selected: CsvRecipeRow[]; seen: number }> {
  const heap = new MaxHeap(rows);
  let seen = 0;
  for await (const row of csvRecords(path)) {
    seen += 1;
    heap.add({ score: deterministicScore(row.id), tie: `${row.id}\0${String(seen).padStart(9, "0")}`, row });
  }
  return { selected: heap.sortedRows(), seen };
}

export async function importRecipes(sourcePath: string, databasePath: string, options: ImportOptions = {}): Promise<ImportSummary> {
  if (!existsSync(sourcePath)) throw new Error(`Source file not found: ${sourcePath}`);
  const sourceSize = statSync(sourcePath).size;
  const sourceHash = await fileSha256(sourcePath);
  const runId = `import_${sourceHash.slice(0, 12)}_${Date.now()}`;
  const db = openStaging(databasePath);
  seedUnits(db);
  db.prepare(`INSERT INTO import_runs (id, source_path, source_hash, source_size, tool_version, parser_version, status) VALUES (?, ?, ?, ?, ?, ?, 'running')`)
    .run(runId, sourcePath, sourceHash, sourceSize, TOOL_VERSION, PARSER_VERSION);
  let rowsSeen = 0; let rowsImported = 0; let rowsRejected = 0; let issueCount = 0; let repairedSteps = 0; let unresolvedIngredients = 0;
  const selected = options.sample && options.rows
    ? await selectSample(sourcePath, options.rows)
    : null;
  const records: AsyncIterable<CsvRecipeRow> | CsvRecipeRow[] = selected?.selected ?? csvRecords(sourcePath);
  rowsSeen = selected?.seen ?? 0;
  db.exec("BEGIN");
  try {
    let position = 0;
    const importedSourceIds = new Set<string>();
    for await (const row of records) {
      position += 1;
      if (!selected) rowsSeen += 1;
      const sourceId = row.id.trim();
      if (importedSourceIds.has(sourceId)) {
        rowsRejected += 1;
        issueCount += 1;
        db.prepare(`INSERT INTO import_issues (id, import_run_id, source_recipe_id, row_number, field, severity, reason_code, raw_excerpt) VALUES (?, ?, ?, ?, 'id', 'error', 'duplicate_source_id', ?)`)
          .run(`${runId}_duplicate_${position}`, runId, sourceId, position, row.name.slice(0, 500));
        continue;
      }
      importedSourceIds.add(sourceId);
      const parsed = parseRecipeRow(row);
      insertParsedRecipe(db, runId, position, parsed, sourceHash);
      rowsImported += 1;
      issueCount += parsed.issues.length;
      if (parsed.qualityFlags.includes("steps_repaired")) repairedSteps += 1;
      unresolvedIngredients += parsed.ingredients.filter((item) => item.parseStatus === "unresolved").length;
      if (!options.sample && options.rows && rowsImported >= options.rows) break;
    }
    const metric = db.prepare("INSERT OR REPLACE INTO import_metrics (import_run_id, metric_name, metric_value) VALUES (?, ?, ?)");
    metric.run(runId, "issues", issueCount); metric.run(runId, "steps_repaired", repairedSteps); metric.run(runId, "ingredients_unresolved", unresolvedIngredients);
    db.prepare(`UPDATE import_runs SET status = 'completed', rows_seen = ?, rows_imported = ?, rows_rejected = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(rowsSeen, rowsImported, rowsRejected, runId);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.prepare(`UPDATE import_runs SET status = 'failed', error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?`).run(error instanceof Error ? error.message : String(error), runId);
    db.close();
    throw error;
  }
  db.close();
  return { runId, sourcePath, sourceHash, sourceSize, rowsSeen, rowsImported, rowsRejected, issueCount, repairedSteps, unresolvedIngredients, databasePath };
}

export async function analyzeCsv(sourcePath: string) {
  let rows = 0; let ingredientFailures = 0; let rawFailures = 0; let stepFailures = 0; let tagFailures = 0;
  for await (const row of csvRecords(sourcePath)) {
    rows += 1;
    if (parseStringList(row.ingredients).status === "failed") ingredientFailures += 1;
    if (parseStringList(row.ingredients_raw).status === "failed") rawFailures += 1;
    if (parseStringList(row.steps).status === "failed") stepFailures += 1;
    if (parseStringList(row.tags).status === "failed") tagFailures += 1;
  }
  return { sourcePath, rows, ingredientFailures, rawFailures, stepFailures, tagFailures };
}

export function writeQaReport(databasePath: string, outputDirectory: string): string {
  mkdirSync(outputDirectory, { recursive: true });
  const db = new DatabaseSync(databasePath, { readOnly: true });
  const run = db.prepare("SELECT * FROM import_runs ORDER BY started_at DESC LIMIT 1").get() as Record<string, SQLInputValue>;
  const issues = db.prepare("SELECT field, severity, reason_code, COUNT(*) AS count FROM import_issues WHERE import_run_id = ? GROUP BY field, severity, reason_code ORDER BY count DESC").all(run.id) as Array<Record<string, SQLInputValue>>;
  const counts = Object.fromEntries(["recipes", "recipe_ingredients", "recipe_steps", "ingredients", "tags", "recipe_search_fts"].map((table) => [table, Number((db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count)]));
  db.close();
  const report = { generatedAt: new Date().toISOString(), run, counts, issues };
  const jsonPath = join(outputDirectory, "qa-report.json");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  const markdown = [
    "# Recipe Import QA Report", "", `Generated: ${report.generatedAt}`, "", "## Counts", "",
    "| Table | Rows |", "| --- | ---: |", ...Object.entries(counts).map(([table, count]) => `| ${table} | ${count} |`),
    "", "## Issues", "", "| Field | Severity | Reason | Count |", "| --- | --- | --- | ---: |",
    ...issues.map((issue) => `| ${issue.field} | ${issue.severity} | ${issue.reason_code} | ${issue.count} |`), "",
  ].join("\n");
  writeFileSync(join(outputDirectory, "qa-report.md"), markdown);
  return jsonPath;
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

const exportTables = ["units", "recipes", "ingredients", "ingredient_aliases", "recipe_steps", "recipe_ingredients", "tags", "recipe_tags", "import_runs", "import_issues", "import_metrics"];

export async function exportSql(databasePath: string, outputDirectory: string): Promise<string> {
  mkdirSync(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, "catalog.sql");
  const stream = createWriteStream(outputPath);
  const db = new DatabaseSync(databasePath, { readOnly: true });
  stream.write("PRAGMA foreign_keys = ON;\n");
  const recipeIds = db.prepare("SELECT id FROM recipes ORDER BY id").all() as Array<{ id: string }>;
  for (let index = 0; index < recipeIds.length; index += 100) {
    stream.write(`DELETE FROM recipe_search_fts WHERE recipe_id IN (${recipeIds.slice(index, index + 100).map((row) => sqlLiteral(row.id)).join(",")});\n`);
  }
  for (const table of exportTables) {
    const tableInfo = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; pk: number }>;
    const columns = tableInfo.map((column) => column.name);
    const primaryKey = tableInfo.filter((column) => column.pk > 0).sort((left, right) => left.pk - right.pk).map((column) => column.name);
    if (!primaryKey.length) throw new Error(`Cannot export ${table} without a primary key`);
    const mutableColumns = columns.filter((column) => !primaryKey.includes(column));
    const conflictClause = mutableColumns.length
      ? `ON CONFLICT (${primaryKey.join(",")}) DO UPDATE SET ${mutableColumns.map((column) => `${column}=excluded.${column}`).join(",")}`
      : `ON CONFLICT (${primaryKey.join(",")}) DO NOTHING`;
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>;
    for (let index = 0; index < rows.length; index += 50) {
      const values = rows.slice(index, index + 50).map((row) => `(${columns.map((column) => sqlLiteral(row[column])).join(",")})`).join(",\n");
      if (values) stream.write(`INSERT INTO ${table} (${columns.join(",")}) VALUES\n${values}\n${conflictClause};\n`);
    }
  }
  const ftsRows = db.prepare("SELECT recipe_id, name, description, ingredients_text, tags_text, steps_text FROM recipe_search_fts").all() as Array<Record<string, unknown>>;
  for (let index = 0; index < ftsRows.length; index += 50) {
    const rows = ftsRows.slice(index, index + 50).map((row) => `(${["recipe_id", "name", "description", "ingredients_text", "tags_text", "steps_text"].map((column) => sqlLiteral(row[column])).join(",")})`).join(",\n");
    stream.write(`INSERT INTO recipe_search_fts (recipe_id,name,description,ingredients_text,tags_text,steps_text) VALUES\n${rows};\n`);
  }
  db.close();
  await new Promise<void>((resolvePromise, reject) => {
    stream.once("error", reject);
    stream.end(resolvePromise);
  });
  return outputPath;
}

async function applySql(path: string, environment?: string) {
  const files = statSync(path).isDirectory() ? (await readdir(path)).filter((file) => file.endsWith(".sql")).sort().map((file) => join(path, file)) : [path];
  for (const file of files) {
    const args = ["wrangler", "d1", "execute", "DB", "--file", file];
    if (environment) args.push("--env", environment, "--remote"); else args.push("--local");
    console.log(`Applying ${file} to ${environment ?? "local"} D1...`);
    const result = spawnSync("npx", args, { stdio: ["ignore", "ignore", "inherit"] });
    if (result.status !== 0) throw new Error(`Failed to apply ${file}`);
  }
}

async function main() {
  const program = new Command().name("import-recipes").description("Analyze, stage, validate, and load the recipe CSV").version(TOOL_VERSION);
  program.command("analyze").argument("<csv>").action(async (csv) => console.log(JSON.stringify(await analyzeCsv(resolve(csv)), null, 2)));
  program.command("sample").argument("<csv>").requiredOption("--rows <count>", "sample size", Number).requiredOption("--out <path>").option("--apply-local").action(async (csv, options) => {
    const out = resolve(options.out); const summary = await importRecipes(resolve(csv), out, { rows: options.rows, sample: true });
    const reportDir = resolve(".import/reports/sample"); writeQaReport(out, reportDir); const sql = await exportSql(out, resolve(".import/sql/sample"));
    if (options.applyLocal) await applySql(sql);
    console.log(JSON.stringify(summary, null, 2));
  });
  program.command("stage").argument("<csv>").requiredOption("--out <path>").option("--rows <count>", "optional bounded smoke import", Number).action(async (csv, options) => console.log(JSON.stringify(await importRecipes(resolve(csv), resolve(options.out), { rows: options.rows }), null, 2)));
  program.command("normalize").argument("<database>").action((database) => { const report = writeQaReport(resolve(database), resolve(".import/reports/normalize")); console.log(`Normalization occurs during staging; verified ${report}`); });
  program.command("qa").argument("<database>").requiredOption("--out <directory>").action((database, options) => console.log(writeQaReport(resolve(database), resolve(options.out))));
  program.command("export-sql").argument("<database>").requiredOption("--out <directory>").action(async (database, options) => console.log(await exportSql(resolve(database), resolve(options.out))));
  program.command("apply-local").argument("<path>").action((path) => applySql(resolve(path)));
  program.command("apply-remote").argument("<path>").requiredOption("--env <environment>").requiredOption("--confirm", "confirm remote mutation").action((path, options) => applySql(resolve(path), options.env));
  await program.parseAsync();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
