package com.tableplan.email

import com.tableplan.config.TableplanProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import tools.jackson.databind.ObjectMapper

@Configuration(proxyBeanMethods = false)
class EmailConfiguration {
    @Bean
    fun emailSender(
        properties: TableplanProperties,
        mapper: ObjectMapper,
    ): EmailSender {
        val config = properties.email
        if (config.cloudflareAccountId.isBlank() && config.cloudflareApiToken.isBlank()) {
            return LoggingEmailSender()
        }
        check(config.cloudflareAccountId.isNotBlank() && config.cloudflareApiToken.isNotBlank()) {
            "Both tableplan.email.cloudflare-account-id and tableplan.email.cloudflare-api-token " +
                "must be configured. Refusing to fall back to captured email delivery."
        }
        return CloudflareEmailSender(
            accountId = config.cloudflareAccountId,
            apiToken = config.cloudflareApiToken,
            fromAddress = config.fromAddress,
            fromName = config.fromName,
            timeoutSeconds = config.timeoutSeconds,
            mapper = mapper,
        )
    }
}
