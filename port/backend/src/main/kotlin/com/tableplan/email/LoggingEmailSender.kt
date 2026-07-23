package com.tableplan.email

import org.slf4j.LoggerFactory
import java.util.UUID

class LoggingEmailSender : EmailSender {
    private val logger = LoggerFactory.getLogger(javaClass)

    override fun send(recipient: String, subject: String, html: String, text: String): String {
        val id = "local-${UUID.randomUUID()}"
        logger.info("email.captured providerMessageId={} template=shopping-share", id)
        return id
    }
}
