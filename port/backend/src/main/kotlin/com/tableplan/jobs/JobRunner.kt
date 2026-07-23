package com.tableplan.jobs

import com.tableplan.config.TableplanProperties
import org.slf4j.LoggerFactory
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Component
import jakarta.annotation.PreDestroy
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit

@Component
class JobRunner(
    private val properties: TableplanProperties,
    private val jobs: JobService,
    handlers: List<JobHandler>,
) {
    private val logger = LoggerFactory.getLogger(javaClass)
    private val workerId = "tableplan-${UUID.randomUUID()}"
    private val handlers = handlers.associateBy(JobHandler::type)
    private val capacity = Semaphore(properties.jobs.concurrency)
    private val executor =
        Executors.newFixedThreadPool(properties.jobs.concurrency) { work ->
            Thread(work, "tableplan-job").apply { isDaemon = false }
        }

    @Scheduled(fixedDelayString = "\${tableplan.jobs.poll-delay-ms:1000}")
    fun poll() {
        if (!properties.jobs.enabled) return
        repeat(properties.jobs.concurrency) {
            if (!capacity.tryAcquire()) return
            val job = jobs.claim(workerId)
            if (job == null) {
                capacity.release()
                return
            }
            executor.submit {
                try {
                    val handler = handlers[job.type]
                    if (handler == null) {
                        jobs.fail(job, "handler_not_found", retryable = false)
                    } else {
                        handler.handle(job)
                        jobs.complete(job)
                    }
                } catch (error: RetryableJobException) {
                    logger.warn("job.retry type={} code={}", job.type, error.code)
                    jobs.fail(job, error.code, retryable = true)
                } catch (error: Exception) {
                    logger.error("job.failed type={}", job.type, error)
                    jobs.fail(job, "handler_failed", retryable = false)
                } finally {
                    capacity.release()
                }
            }
        }
    }

    @PreDestroy
    fun shutdown() {
        executor.shutdown()
        if (!executor.awaitTermination(20, TimeUnit.SECONDS)) executor.shutdownNow()
    }
}
