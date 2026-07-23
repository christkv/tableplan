package com.tableplan.email

interface EmailSender {
    fun send(recipient: String, subject: String, html: String, text: String): String
}

