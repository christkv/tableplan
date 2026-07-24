package com.tableplan.jobs

import com.mongodb.client.MongoDatabase
import com.mongodb.client.model.Filters
import com.mongodb.client.model.FindOneAndUpdateOptions
import com.mongodb.client.model.IndexOptions
import com.mongodb.client.model.Indexes
import com.mongodb.client.model.ReturnDocument
import com.mongodb.client.model.UpdateOptions
import com.mongodb.client.model.Updates
import org.bson.Document
import org.bson.conversions.Bson
import org.springframework.stereotype.Service
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.util.Date
import java.util.UUID

data class LeasedJob(
    val id: String,
    val type: String,
    val payload: Document,
    val attempts: Int,
    val leaseOwner: String,
)

data class JobQueueStatus(
    val counts: Map<String, Long>,
    val oldestAvailableAt: Instant?,
)

@Service
class JobService(
    database: MongoDatabase,
    private val clock: Clock,
) {
    private val jobs = database.getCollection("jobs")

    fun ensureIndexes() {
        jobs.createIndex(
            Indexes.compoundIndex(
                Indexes.ascending("status"),
                Indexes.ascending("availableAt"),
                Indexes.ascending("leaseExpiresAt"),
            ),
            IndexOptions().name("job_claim"),
        )
        jobs.createIndex(
            Indexes.ascending("idempotencyKey"),
            IndexOptions().name("job_idempotency").unique(true).sparse(true),
        )
    }

    fun publish(type: String, payload: Document, idempotencyKey: String? = null): String {
        val id = UUID.randomUUID().toString()
        val now = Date.from(clock.instant())
        jobs.updateOne(
            idempotencyKey?.let { Filters.eq("idempotencyKey", it) } ?: Filters.eq("_id", id),
            Updates.combine(
                Updates.setOnInsert("_id", id),
                Updates.setOnInsert("type", type),
                Updates.setOnInsert("schemaVersion", 1),
                Updates.setOnInsert("payload", payload),
                Updates.setOnInsert("status", "queued"),
                Updates.setOnInsert("attempts", 0),
                Updates.setOnInsert("availableAt", now),
                Updates.setOnInsert("leaseOwner", null),
                Updates.setOnInsert("leaseExpiresAt", null),
                Updates.setOnInsert("idempotencyKey", idempotencyKey),
                Updates.setOnInsert("createdAt", now),
                Updates.setOnInsert("updatedAt", now),
            ),
            UpdateOptions().upsert(true),
        )
        return if (idempotencyKey == null) {
            id
        } else {
            jobs.find(Filters.eq("idempotencyKey", idempotencyKey)).projection(Document("_id", 1)).first()
                ?.getString("_id") ?: id
        }
    }

    fun claim(worker: String, lease: Duration = Duration.ofMinutes(2)): LeasedJob? {
        val now = clock.instant()
        val document =
            jobs.findOneAndUpdate(
                jobClaimFilter(now),
                Updates.combine(
                    Updates.set("status", "running"),
                    Updates.set("leaseOwner", worker),
                    Updates.set("leaseExpiresAt", Date.from(now.plus(lease))),
                    Updates.inc("attempts", 1),
                    Updates.set("updatedAt", Date.from(now)),
                ),
                FindOneAndUpdateOptions()
                    .sort(Document("availableAt", 1).append("createdAt", 1))
                    .returnDocument(ReturnDocument.AFTER),
            ) ?: return null
        return LeasedJob(
            document.getString("_id"),
            document.getString("type"),
            document.get("payload", Document::class.java),
            (document["attempts"] as Number).toInt(),
            worker,
        )
    }

    fun complete(job: LeasedJob) {
        jobs.updateOne(
            ownedLease(job),
            Updates.combine(
                Updates.set("status", "completed"),
                Updates.set("completedAt", Date.from(clock.instant())),
                Updates.set("leaseOwner", null),
                Updates.set("leaseExpiresAt", null),
                Updates.set("updatedAt", Date.from(clock.instant())),
            ),
        )
    }

    fun fail(job: LeasedJob, errorCode: String, retryable: Boolean) {
        val now = clock.instant()
        val terminal = !retryable || job.attempts >= 5
        val backoffSeconds = (5L shl (job.attempts - 1).coerceIn(0, 8)).coerceAtMost(900)
        jobs.updateOne(
            ownedLease(job),
            Updates.combine(
                Updates.set("status", if (terminal) "dead" else "retry"),
                Updates.set("lastErrorCode", errorCode.take(100)),
                Updates.set("availableAt", Date.from(now.plusSeconds(backoffSeconds))),
                Updates.set("leaseOwner", null),
                Updates.set("leaseExpiresAt", null),
                Updates.set("updatedAt", Date.from(now)),
            ),
        )
    }

    fun status(): JobQueueStatus {
        val counts =
            jobs.aggregate(
                listOf(
                    Document("\$group", Document("_id", "\$status").append("count", Document("\$sum", 1))),
                    Document("\$sort", Document("_id", 1)),
                ),
            ).associate { it.getString("_id") to (it["count"] as Number).toLong() }
        val oldest =
            jobs.find(Filters.`in`("status", listOf("queued", "retry")))
                .sort(Document("availableAt", 1))
                .projection(Document("availableAt", 1))
                .first()
                ?.getDate("availableAt")
                ?.toInstant()
        return JobQueueStatus(counts, oldest)
    }

    fun replayDead(id: String): Boolean {
        val now = Date.from(clock.instant())
        val result =
            jobs.updateOne(
                Filters.and(Filters.eq("_id", id), Filters.eq("status", "dead")),
                Updates.combine(
                    Updates.set("status", "queued"),
                    Updates.set("attempts", 0),
                    Updates.set("availableAt", now),
                    Updates.set("leaseOwner", null),
                    Updates.set("leaseExpiresAt", null),
                    Updates.unset("lastErrorCode"),
                    Updates.set("updatedAt", now),
                ),
            )
        return result.modifiedCount == 1L
    }

    private fun ownedLease(job: LeasedJob) =
        Filters.and(
            Filters.eq("_id", job.id),
            Filters.eq("status", "running"),
            Filters.eq("leaseOwner", job.leaseOwner),
        )
}

internal fun jobClaimFilter(now: Instant): Bson =
    Filters.or(
        Filters.and(
            Filters.`in`("status", listOf("queued", "retry")),
            Filters.lte("availableAt", Date.from(now)),
            Filters.or(
                Filters.eq("leaseExpiresAt", null),
                Filters.lte("leaseExpiresAt", Date.from(now)),
            ),
        ),
        Filters.and(
            Filters.eq("status", "running"),
            Filters.lte("leaseExpiresAt", Date.from(now)),
        ),
    )
