package com.tableplan.email

import org.springframework.boot.autoconfigure.condition.ConditionalOnBean
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.mail.javamail.JavaMailSender

@Configuration(proxyBeanMethods = false)
class EmailConfiguration {
    @Bean
    @ConditionalOnBean(JavaMailSender::class)
    fun smtpEmailSender(mail: JavaMailSender): EmailSender = SmtpEmailSender(mail)

    @Bean
    @ConditionalOnMissingBean(JavaMailSender::class)
    fun loggingEmailSender(): EmailSender = LoggingEmailSender()
}
