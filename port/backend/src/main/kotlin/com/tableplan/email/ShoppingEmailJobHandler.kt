package com.tableplan.email

import com.tableplan.jobs.JobHandler
import com.tableplan.jobs.LeasedJob
import com.tableplan.jobs.RetryableJobException
import org.springframework.stereotype.Component

@Component
class ShoppingEmailJobHandler(
    private val deliveries: EmailDeliveryService,
) : JobHandler {
    override val type: String = TYPE

    override fun handle(job: LeasedJob) {
        val deliveryId = job.payload.getString("deliveryId") ?: error("delivery_id_missing")
        runCatching { deliveries.send(deliveryId) }
            .getOrElse { error ->
                if (error is CloudflareEmailException && !error.retryable) throw error
                throw RetryableJobException("email_send_failed", error)
            }
    }

    companion object {
        const val TYPE = "shopping-email"
    }
}
