package com.tableplan.migration

import com.mongodb.client.MongoDatabase
import com.mongodb.MongoClientSettings
import com.mongodb.client.model.CreateCollectionOptions
import com.mongodb.client.model.ValidationAction
import com.mongodb.client.model.ValidationLevel
import com.mongodb.client.model.ValidationOptions
import org.bson.Document
import org.springframework.stereotype.Service
import java.time.Clock
import java.util.Date

data class MigrationReport(
    val dryRun: Boolean,
    val actions: List<String>,
    val atlasSearchNote: String =
        "Run sync-indexes to reconcile the MongoDB Search index recipes_v1.",
)

data class SearchIndexMigrationReport(
    val dryRun: Boolean,
    val actions: List<String>,
)

@Service
class SchemaMigrator(
    private val database: MongoDatabase,
    private val clock: Clock,
) {
    fun reconcile(dryRun: Boolean): MigrationReport {
        val actions = mutableListOf<String>()
        val existingCollections = database.listCollectionNames().toSet()
        val migrationId = "0001-tableplan-baseline"
        val migrationChecksum = "schema-manifest-v1"
        val appliedMigration =
            if ("schema_migrations" in existingCollections) {
                database.getCollection("schema_migrations").find(Document("_id", migrationId)).first()
            } else {
                null
            }
        check(appliedMigration == null || appliedMigration.getString("checksum") == migrationChecksum) {
            "Migration checksum mismatch for $migrationId; refusing to reconcile schema"
        }
        val collectionDetails =
            database.listCollections().associateBy { it.getString("name") }
        SchemaManifest.collections.forEach { schema ->
            if (schema.name !in existingCollections) {
                actions += "create collection ${schema.name}"
                if (!dryRun) {
                    val options =
                        schema.validator?.let {
                            CreateCollectionOptions().validationOptions(
                                ValidationOptions()
                                    .validator(it)
                                    .validationLevel(ValidationLevel.MODERATE)
                                    .validationAction(ValidationAction.ERROR),
                            )
                        } ?: CreateCollectionOptions()
                    database.createCollection(schema.name, options)
                }
            } else if (
                schema.validator != null &&
                run {
                    val options = collectionDetails[schema.name]?.get("options") as? Document
                    (options?.get("validator") as? Document) != schema.validator ||
                        options?.getString("validationLevel") != "moderate" ||
                        options?.getString("validationAction") != "error"
                }
            ) {
                actions += "reconcile validator ${schema.name}"
                if (!dryRun) {
                    database.runCommand(
                        Document("collMod", schema.name)
                            .append("validator", schema.validator)
                            .append("validationLevel", "moderate")
                            .append("validationAction", "error"),
                    )
                }
            }
            val existingIndexes =
                if (schema.name in existingCollections || !dryRun) {
                    database.getCollection(schema.name).listIndexes()
                        .mapNotNull { index -> index.getString("name")?.let { it to index } }
                        .toMap()
                } else {
                    emptyMap()
                }
            schema.obsoleteIndexes
                .filter(existingIndexes::containsKey)
                .forEach { name ->
                    actions += "drop obsolete index ${schema.name}.$name"
                    if (!dryRun) database.getCollection(schema.name).dropIndex(name)
                }
            schema.indexes.forEach { model ->
                val name = requireNotNull(model.options.name)
                val existing = existingIndexes[name]
                if (existing == null) {
                    actions += "create index ${schema.name}.$name"
                    if (!dryRun) database.getCollection(schema.name).createIndex(model.keys, model.options)
                } else if (!equivalentIndex(existing, model)) {
                    actions += "index drift ${schema.name}.$name requires reviewed drop/recreate"
                }
            }
        }
        if (!dryRun && appliedMigration == null) {
            database.getCollection("schema_migrations").insertOne(
                Document("_id", migrationId)
                    .append("description", "Tableplan Spring Boot baseline")
                    .append("checksum", migrationChecksum)
                    .append("status", "completed")
                    .append("completedAt", Date.from(clock.instant())),
            )
        }
        return MigrationReport(dryRun, actions)
    }

    fun reconcileSearchIndexes(dryRun: Boolean): SearchIndexMigrationReport {
        val actions = mutableListOf<String>()
        SchemaManifest.searchIndexes.forEach { schema ->
            val collection = database.getCollection(schema.collection)
            val existing =
                collection.listSearchIndexes()
                    .toList()
                    .firstOrNull { it.getString("name") == schema.name }
            when {
                existing == null -> {
                    actions += "create search index ${schema.collection}.${schema.name}"
                    if (!dryRun) collection.createSearchIndex(schema.name, schema.definition)
                }
                !hasRequiredSortableTokenMappings(existing, schema) -> {
                    actions +=
                        "update search index ${schema.collection}.${schema.name} " +
                        "with sortable token mappings ${schema.requiredSortableTokenFields.sorted().joinToString(",")}"
                    if (!dryRun) collection.updateSearchIndex(schema.name, schema.definition)
                }
            }
        }
        return SearchIndexMigrationReport(dryRun, actions)
    }

    private fun hasRequiredSortableTokenMappings(existing: Document, expected: SearchIndexSchema): Boolean {
        val definition =
            existing.get("latestDefinition", Document::class.java)
                ?: existing.get("definition", Document::class.java)
                ?: return false
        val mappings = definition.get("mappings", Document::class.java) ?: return false
        val fields = mappings.get("fields", Document::class.java) ?: return false
        return expected.requiredSortableTokenFields.all { field ->
            val mappingsForField =
                when (val mapping = fields[field]) {
                    is Document -> listOf(mapping)
                    is List<*> -> mapping.filterIsInstance<Document>()
                    else -> emptyList()
                }
            mappingsForField.any {
                it.getString("type") == "token" && it.getString("normalizer") == "none"
            }
        }
    }

    private fun equivalentIndex(existing: Document, expected: com.mongodb.client.model.IndexModel): Boolean {
        val expectedKeys =
            expected.keys.toBsonDocument(Document::class.java, MongoClientSettings.getDefaultCodecRegistry())
        val actualKeys =
            existing.get("key", Document::class.java)
                .toBsonDocument(Document::class.java, MongoClientSettings.getDefaultCodecRegistry())
        if (actualKeys != expectedKeys) return false
        val expectedUnique = expected.options.isUnique
        val expectedSparse = expected.options.isSparse
        if ((existing.getBoolean("unique", false)) != expectedUnique) return false
        if ((existing.getBoolean("sparse", false)) != expectedSparse) return false
        val expectedTtl = expected.options.getExpireAfter(java.util.concurrent.TimeUnit.SECONDS)
        val actualTtl = (existing["expireAfterSeconds"] as? Number)?.toLong()
        return expectedTtl == actualTtl
    }
}
