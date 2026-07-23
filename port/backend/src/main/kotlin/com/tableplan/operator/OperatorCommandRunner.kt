package com.tableplan.operator

import com.tableplan.config.TableplanProperties
import com.tableplan.importer.CatalogImportOptions
import com.tableplan.importer.CatalogImporter
import com.tableplan.importer.FacetRefresher
import com.tableplan.jobs.JobService
import com.tableplan.migration.SchemaMigrator
import org.springframework.stereotype.Component
import java.nio.file.Path

@Component
class OperatorCommandRunner(
    private val properties: TableplanProperties,
    private val migrations: SchemaMigrator,
    private val importer: CatalogImporter,
    private val facets: FacetRefresher,
    private val jobs: JobService,
) {
    fun run(command: String, arguments: List<String>): Int {
        val options = arguments.filter { it.startsWith("--") }.associate {
            val pair = it.removePrefix("--").split("=", limit = 2)
            pair[0] to pair.getOrElse(1) { "true" }
        }
        return when (command) {
            "migrate", "sync-indexes" -> {
                guardProduction(options)
                val report = migrations.reconcile(options["dry-run"] == "true")
                report.actions.forEach(::println)
                println(report.atlasSearchNote)
                0
            }
            "import-catalog" -> {
                guardProduction(options)
                val source = options["file"] ?: arguments.firstOrNull { !it.startsWith("--") }
                    ?: error("import-catalog requires --file=/path/to/recipes.csv")
                println(
                    importer.import(
                        CatalogImportOptions(
                            source = Path.of(source).toAbsolutePath().normalize(),
                            batchSize = options["batch-size"]?.toInt() ?: 500,
                            limit = options["limit"]?.toInt(),
                            runId = options["run-id"],
                            dryRun = options["dry-run"] == "true",
                        ),
                    ),
                )
                0
            }
            "refresh-recipe-facets" -> {
                guardProduction(options)
                println("Recipe facet counts refreshed: ${facets.refresh()} tags in ${properties.mongo.database}")
                0
            }
            "jobs-status" -> {
                val status = jobs.status()
                println("Job counts: ${status.counts.toSortedMap()}")
                println("Oldest available: ${status.oldestAvailableAt ?: "none"}")
                0
            }
            "replay-job" -> {
                guardProduction(options)
                val id = options["id"] ?: error("replay-job requires --id=JOB_ID")
                if (!jobs.replayDead(id)) error("Dead job not found: $id")
                println("Requeued dead job $id")
                0
            }
            "help", "--help", "-h" -> {
                printHelp()
                0
            }
            else -> {
                System.err.println("Unknown command: $command")
                printHelp()
                2
            }
        }
    }

    private fun guardProduction(options: Map<String, String>) {
        if (properties.mongo.database == "application" && options["allow-production"] != "true") {
            error("Operating on production requires --allow-production")
        }
    }

    private fun printHelp() {
        println(
            """
            Usage: java -jar tableplan.jar <command> [options]
              serve
              migrate [--dry-run] [--allow-production]
              sync-indexes [--dry-run] [--allow-production]
              import-catalog --file=recipes.csv [--batch-size=500] [--limit=N] [--run-id=ID] [--dry-run]
              refresh-recipe-facets [--allow-production]
              jobs-status
              replay-job --id=JOB_ID [--allow-production]
            """.trimIndent(),
        )
    }
}
