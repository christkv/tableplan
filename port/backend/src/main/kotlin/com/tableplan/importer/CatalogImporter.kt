package com.tableplan.importer

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.ReplaceOneModel
import com.mongodb.client.model.ReplaceOptions
import com.mongodb.client.model.UpdateOneModel
import com.mongodb.client.model.UpdateOptions
import com.mongodb.client.model.Updates
import com.mongodb.client.model.WriteModel
import org.apache.commons.csv.CSVFormat
import org.bson.Document
import org.springframework.stereotype.Service
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.time.Clock
import java.util.Date

data class CatalogImportOptions(
    val source: Path,
    val batchSize: Int = 500,
    val limit: Int? = null,
    val runId: String? = null,
    val dryRun: Boolean = false,
)

data class CatalogImportReport(
    val runId: String,
    val sourceHash: String,
    val checkpointRow: Int,
    val imported: Int,
    val rejected: Int,
    val status: String,
)

@Service
class CatalogImporter(
    private val database: MongoDatabase,
    private val facets: FacetRefresher,
    private val clock: Clock,
) {
    fun import(options: CatalogImportOptions): CatalogImportReport {
        require(Files.isRegularFile(options.source)) { "Source file not found: ${options.source}" }
        require(options.batchSize in 1..1000) { "Batch size must be between 1 and 1000" }
        require(options.limit == null || options.limit > 0) { "Limit must be a positive integer" }
        val sourceHash = sha256(options.source)
        val runId = options.runId ?: "catalog_${sourceHash.take(16)}"
        val runs = database.getCollection("import_runs")
        val previous = if (options.dryRun) null else runs.find(Document("_id", runId)).first()
        val checkpoint = (previous?.get("checkpointRow") as? Number)?.toInt() ?: 0
        val now = Date.from(clock.instant())
        if (!options.dryRun) {
            runs.updateOne(
                Document("_id", runId),
                Updates.combine(
                    Updates.set("sourcePath", options.source.fileName.toString()),
                    Updates.set("sourceHash", sourceHash),
                    Updates.set("sourceSize", Files.size(options.source)),
                    Updates.set("importerVersion", "spring-1.0.0"),
                    Updates.set("status", "running"),
                    Updates.set("resumedAt", now),
                    Updates.setOnInsert("_id", runId),
                    Updates.setOnInsert("startedAt", now),
                    Updates.setOnInsert("rowsImported", 0),
                    Updates.setOnInsert("rowsRejected", 0),
                ),
                UpdateOptions().upsert(true),
            )
            seedUnits()
        }
        var rowNumber = 0
        var imported = 0
        var rejected = 0
        var pending = Batch()
        val seen = mutableSetOf<String>()
        var limited = false
        try {
            Files.newBufferedReader(options.source).use { reader ->
                CSVFormat.DEFAULT.builder()
                    .setHeader()
                    .setSkipHeaderRecord(true)
                    .setIgnoreEmptyLines(true)
                    .get()
                    .parse(reader)
                    .forEach { record ->
                        if (options.limit != null && imported >= options.limit) {
                            limited = true
                            return@forEach
                        }
                        rowNumber += 1
                        val row = record.toMap()
                        val sourceId = row["id"].orEmpty().trim()
                        val duplicate = !seen.add(sourceId)
                        if (rowNumber <= checkpoint) return@forEach
                        if (duplicate || sourceId.isEmpty()) {
                            rejected += 1
                            pending.rejected += 1
                            pending.issues += issue(runId, rowNumber, sourceId, "id", "duplicate_source_id")
                        } else {
                            try {
                                val parsed = RecipeImportParser.parse(row, sourceHash)
                                parsed.document["updatedAt"] = now
                                pending.recipes +=
                                    ReplaceOneModel(
                                        Document("_id", parsed.id),
                                        parsed.document,
                                        ReplaceOptions().upsert(true),
                                    )
                                parsed.ingredients.forEach { (id, name) ->
                                    pending.ingredients += upsert(id, Document("canonicalName", name).append("normalizedName", name))
                                }
                                parsed.tags.forEach { (id, name) ->
                                    pending.tags += upsert(id, Document("name", name).append("normalizedName", name))
                                }
                                parsed.issues.forEachIndexed { index, issue ->
                                    pending.issues +=
                                        upsert(
                                            "${runId}_${rowNumber}_$index",
                                            Document("importRunId", runId)
                                                .append("sourceRecipeId", sourceId)
                                                .append("rowNumber", rowNumber)
                                                .append("field", issue.field)
                                                .append("severity", issue.severity)
                                                .append("reasonCode", issue.reasonCode)
                                                .append("rawExcerpt", issue.rawExcerpt),
                                        )
                                }
                                imported += 1
                            } catch (_: IllegalArgumentException) {
                                rejected += 1
                                pending.rejected += 1
                                pending.issues += issue(runId, rowNumber, sourceId, "recipe", "invalid_recipe_row")
                            }
                        }
                        if (pending.rowCount >= options.batchSize) {
                            flush(pending, options.dryRun)
                            if (!options.dryRun) checkpoint(runs, runId, rowNumber, pending.recipes.size, pending.rejected)
                            pending = Batch()
                        }
                    }
            }
            flush(pending, options.dryRun)
            if (!options.dryRun) {
                checkpoint(runs, runId, rowNumber, pending.recipes.size, pending.rejected)
                facets.refresh()
                runs.updateOne(
                    Document("_id", runId),
                    Updates.combine(
                        Updates.set("status", if (limited) "paused" else "completed"),
                        Updates.set("updatedAt", Date.from(clock.instant())),
                        if (limited) Updates.unset("completedAt") else Updates.set("completedAt", Date.from(clock.instant())),
                    ),
                )
            }
            return CatalogImportReport(runId, sourceHash, rowNumber, imported, rejected, if (options.dryRun) "validated" else if (limited) "paused" else "completed")
        } catch (error: Exception) {
            if (!options.dryRun) {
                runs.updateOne(
                    Document("_id", runId),
                    Updates.combine(
                        Updates.set("status", "failed"),
                        Updates.set("checkpointRow", rowNumber),
                        Updates.set("failedAt", Date.from(clock.instant())),
                        Updates.set("errorCode", "catalog_import_failed"),
                    ),
                )
            }
            throw error
        }
    }

    private fun flush(batch: Batch, dryRun: Boolean) {
        if (dryRun) return
        if (batch.recipes.isNotEmpty()) database.getCollection("recipes").bulkWrite(batch.recipes, com.mongodb.client.model.BulkWriteOptions().ordered(false))
        if (batch.ingredients.isNotEmpty()) database.getCollection("ingredients").bulkWrite(batch.ingredients, com.mongodb.client.model.BulkWriteOptions().ordered(false))
        if (batch.tags.isNotEmpty()) database.getCollection("tags").bulkWrite(batch.tags, com.mongodb.client.model.BulkWriteOptions().ordered(false))
        if (batch.issues.isNotEmpty()) database.getCollection("import_issues").bulkWrite(batch.issues, com.mongodb.client.model.BulkWriteOptions().ordered(false))
    }

    private fun checkpoint(runs: com.mongodb.client.MongoCollection<Document>, runId: String, row: Int, imported: Int, rejected: Int) {
        runs.updateOne(
            Document("_id", runId),
            Updates.combine(
                Updates.set("checkpointRow", row),
                Updates.set("updatedAt", Date.from(clock.instant())),
                Updates.inc("rowsImported", imported),
                Updates.inc("rowsRejected", rejected),
            ),
        )
    }

    private fun upsert(id: String, fields: Document): WriteModel<Document> =
        UpdateOneModel(
            Document("_id", id),
            Document("\$set", fields).append("\$setOnInsert", Document("_id", id)),
            UpdateOptions().upsert(true),
        )

    private fun issue(runId: String, row: Int, sourceId: String, field: String, reason: String): WriteModel<Document> =
        upsert(
            "${runId}_${row}_$reason",
            Document("importRunId", runId)
                .append("sourceRecipeId", sourceId)
                .append("rowNumber", row)
                .append("field", field)
                .append("severity", "error")
                .append("reasonCode", reason),
        )

    private fun sha256(path: Path): String {
        val digest = MessageDigest.getInstance("SHA-256")
        Files.newInputStream(path).use { stream ->
            val buffer = ByteArray(64 * 1024)
            while (true) {
                val read = stream.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private fun seedUnits() {
        val definitions =
            listOf(
                listOf("g", "gram", "g", "mass", "metric", "1"),
                listOf("kg", "kilogram", "kg", "mass", "metric", "1000"),
                listOf("oz", "ounce", "oz", "mass", "us", "28.349523125"),
                listOf("lb", "pound", "lb", "mass", "us", "453.59237"),
                listOf("ml", "milliliter", "ml", "volume", "metric", "1"),
                listOf("l", "liter", "L", "volume", "metric", "1000"),
                listOf("tsp", "teaspoon", "tsp", "volume", "us", "4.92892159375"),
                listOf("tbsp", "tablespoon", "tbsp", "volume", "us", "14.78676478125"),
                listOf("cup", "cup", "cup", "volume", "us", "236.5882365"),
                listOf("floz", "fluid ounce", "fl oz", "volume", "us", "29.5735295625"),
                listOf("pint", "pint", "pt", "volume", "us", "473.176473"),
                listOf("quart", "quart", "qt", "volume", "us", "946.352946"),
                listOf("gallon", "gallon", "gal", "volume", "us", "3785.411784"),
                listOf("each", "each", "each", "count", "universal", "1"),
                listOf("clove", "clove", "clove", "count", "universal", "1"),
                listOf("slice", "slice", "slice", "count", "universal", "1"),
                listOf("bunch", "bunch", "bunch", "count", "universal", "1"),
                listOf("pinch", "pinch", "pinch", "count", "universal", "1"),
                listOf("dash", "dash", "dash", "count", "universal", "1"),
                listOf("can", "can", "can", "package", "universal", ""),
                listOf("package", "package", "pkg", "package", "universal", ""),
                listOf("bag", "bag", "bag", "package", "universal", ""),
                listOf("box", "box", "box", "package", "universal", ""),
                listOf("jar", "jar", "jar", "package", "universal", ""),
            )
        database.getCollection("units").bulkWrite(
            definitions.map { unit ->
                upsert(
                    unit[0],
                    Document("canonicalName", unit[1])
                        .append("symbol", unit[2])
                        .append("dimension", unit[3])
                        .append("system", unit[4])
                        .append("toBaseFactor", unit[5].toDoubleOrNull()),
                )
            },
            com.mongodb.client.model.BulkWriteOptions().ordered(false),
        )
    }

    private class Batch {
        val recipes = mutableListOf<WriteModel<Document>>()
        val ingredients = mutableListOf<WriteModel<Document>>()
        val tags = mutableListOf<WriteModel<Document>>()
        val issues = mutableListOf<WriteModel<Document>>()
        var rejected: Int = 0
        val rowCount: Int get() = recipes.size + rejected
    }
}
