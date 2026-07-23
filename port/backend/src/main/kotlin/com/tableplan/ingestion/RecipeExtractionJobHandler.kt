package com.tableplan.ingestion

import com.tableplan.jobs.JobHandler
import com.tableplan.jobs.LeasedJob
import com.tableplan.jobs.RetryableJobException
import org.springframework.stereotype.Component

@Component
class RecipeExtractionJobHandler(
    private val ingestions: IngestionService,
    extractors: List<RecipeExtractor>,
) : JobHandler {
    private val extractor = extractors.first()
    override val type: String = TYPE

    override fun handle(job: LeasedJob) {
        val id = job.payload.getString("ingestionId") ?: error("ingestion_id_missing")
        val (_, bytes) =
            runCatching { ingestions.loadForExtraction(id) }
                .getOrElse { throw RetryableJobException("artifact_unavailable", it) }
        val source = bytes.toString(Charsets.UTF_8)
        val draft = extractor.extract(source)
        ingestions.saveExtracted(id, draft)
    }

    companion object {
        const val TYPE = "recipe-extraction"
    }
}
