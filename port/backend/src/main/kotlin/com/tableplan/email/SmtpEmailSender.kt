package com.tableplan.email

import jakarta.mail.internet.MimeMessage
import org.springframework.mail.javamail.JavaMailSender
import org.springframework.mail.javamail.MimeMessageHelper
import java.util.UUID

class SmtpEmailSender(
    private val mail: JavaMailSender,
) : EmailSender {
    override fun send(recipient: String, subject: String, html: String, text: String): String {
        val message: MimeMessage = mail.createMimeMessage()
        MimeMessageHelper(message, false, Charsets.UTF_8.name()).apply {
            setTo(recipient)
            setSubject(subject)
            setText(text, html)
        }
        mail.send(message)
        return message.messageID ?: "smtp-${UUID.randomUUID()}"
    }
}
