package com.tableplan.auth

import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

object CryptoSupport {
    private val random = SecureRandom()

    fun randomToken(bytes: Int = 32): String =
        ByteArray(bytes)
            .also(random::nextBytes)
            .let { Base64.getUrlEncoder().withoutPadding().encodeToString(it) }

    fun sha256(value: String): String =
        MessageDigest.getInstance("SHA-256")
            .digest(value.toByteArray(Charsets.UTF_8))
            .joinToString("") { "%02x".format(it) }

    fun constantTimeEquals(left: String, right: String): Boolean =
        MessageDigest.isEqual(left.toByteArray(Charsets.UTF_8), right.toByteArray(Charsets.UTF_8))
}

