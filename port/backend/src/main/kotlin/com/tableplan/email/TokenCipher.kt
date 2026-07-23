package com.tableplan.email

import com.tableplan.config.TableplanProperties
import org.springframework.stereotype.Component
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

@Component
class TokenCipher(
    properties: TableplanProperties,
) {
    private val configured = properties.deliverySecret.length >= 32
    private val key =
        SecretKeySpec(
            MessageDigest.getInstance("SHA-256").digest(properties.deliverySecret.toByteArray()),
            "AES",
        )
    private val random = SecureRandom()

    fun encrypt(value: String): String {
        check(configured) { "delivery_secret_not_configured" }
        val nonce = ByteArray(12).also(random::nextBytes)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(128, nonce))
        val encrypted = cipher.doFinal(value.toByteArray(Charsets.UTF_8))
        return Base64.getUrlEncoder().withoutPadding().encodeToString(nonce + encrypted)
    }

    fun decrypt(value: String): String {
        check(configured) { "delivery_secret_not_configured" }
        val bytes = Base64.getUrlDecoder().decode(value)
        require(bytes.size > 28) { "encrypted_token_invalid" }
        val nonce = bytes.copyOfRange(0, 12)
        val encrypted = bytes.copyOfRange(12, bytes.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce))
        return cipher.doFinal(encrypted).toString(Charsets.UTF_8)
    }
}

