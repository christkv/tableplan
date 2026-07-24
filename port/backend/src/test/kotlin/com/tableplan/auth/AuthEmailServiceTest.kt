package com.tableplan.auth

import com.tableplan.config.TableplanProperties
import com.tableplan.email.BrandedEmailRenderer
import com.tableplan.email.EmailSender
import org.junit.jupiter.api.Test
import org.mockito.Mockito
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class AuthEmailServiceTest {
    private val accounts = Mockito.mock(AccountService::class.java)
    private val tokens = Mockito.mock(AuthTokenService::class.java)
    private val sessions = Mockito.mock(SessionRepository::class.java)
    private val sender = CapturingEmailSender()
    private val properties = TableplanProperties(publicOrigin = "https://www.tablerhythm.com")
    private val service = AuthEmailService(accounts, tokens, sessions, sender, BrandedEmailRenderer(), properties)
    private val user =
        AccountUser(
            id = "user-1",
            name = "Test User",
            email = "test@example.com",
            username = "tester",
            householdId = "household-1",
            emailVerified = false,
        )

    @Test
    fun `sends an email confirmation link without exposing the token outside the message`() {
        Mockito.`when`(tokens.issue("user-1", AuthTokenPurpose.EMAIL_VERIFICATION)).thenReturn("secure-token")

        val status = service.sendVerification(user)

        assertEquals(AuthEmailDeliveryStatus.SENT, status)
        assertEquals("test@example.com", sender.messages.single().recipient)
        assertEquals("Confirm your Table Rhythm email", sender.messages.single().subject)
        assertTrue(
            sender.messages.single().text.contains(
                "https://www.tablerhythm.com/verify-email#token=secure-token",
            ),
        )
        assertTrue(sender.messages.single().html.contains("Table Rhythm"))
        assertTrue(sender.messages.single().html.contains("Alpha"))
        assertTrue(sender.messages.single().html.contains("Confirm email&nbsp;&rarr;"))
    }

    @Test
    fun `password reset consumes one token and revokes every existing session`() {
        Mockito.`when`(tokens.consumePasswordReset("secure-token")).thenReturn("user-1")

        service.resetPassword("secure-token", "a-secure-new-password")

        Mockito.verify(accounts).resetPassword("user-1", "a-secure-new-password")
        Mockito.verify(sessions).revokeUser("user-1")
    }

    @Test
    fun `unknown password reset email has the same no-op behavior`() {
        Mockito.`when`(accounts.findByEmail("missing@example.com")).thenReturn(null)

        service.requestPasswordReset("missing@example.com")

        Mockito.verifyNoInteractions(tokens)
        assertTrue(sender.messages.isEmpty())
    }

    private data class CapturedEmail(
        val recipient: String,
        val subject: String,
        val html: String,
        val text: String,
    )

    private class CapturingEmailSender : EmailSender {
        val messages = mutableListOf<CapturedEmail>()

        override fun send(recipient: String, subject: String, html: String, text: String): String {
            messages += CapturedEmail(recipient, subject, html, text)
            return "provider-${messages.size}"
        }
    }
}
