package com.tableplan.auth

import com.tableplan.api.ApiException
import com.tableplan.config.TableplanProperties
import com.tableplan.email.BrandedEmailRenderer
import com.tableplan.email.BrandedEmailTemplate
import com.tableplan.email.EmailSender
import org.slf4j.LoggerFactory
import org.springframework.stereotype.Service

enum class AuthEmailDeliveryStatus {
    SENT,
    FAILED,
    THROTTLED,
}

@Service
class AuthEmailService(
    private val accounts: AccountService,
    private val tokens: AuthTokenService,
    private val sessions: SessionRepository,
    private val sender: EmailSender,
    private val emailRenderer: BrandedEmailRenderer,
    private val properties: TableplanProperties,
) {
    private val logger = LoggerFactory.getLogger(javaClass)

    fun sendVerification(user: AccountUser): AuthEmailDeliveryStatus {
        if (user.emailVerified) return AuthEmailDeliveryStatus.THROTTLED
        return deliver(
            user = user,
            purpose = AuthTokenPurpose.EMAIL_VERIFICATION,
            path = "/verify-email",
            subject = "Confirm your Table Rhythm email",
            heading = "Confirm your email address",
            action = "Confirm email",
            explanation = "Confirm this address to finish creating your Table Rhythm account.",
            note = "If you did not create a Table Rhythm account, you can safely ignore this email.",
        )
    }

    fun requestVerification(email: String) {
        val user = accounts.findByEmail(email) ?: return
        if (!accounts.hasCredentialAccount(user.id) || user.emailVerified) return
        sendVerification(user)
    }

    fun confirmEmail(token: String) {
        val userId =
            tokens.consumeEmailVerification(token)
                ?: throw ApiException(
                    400,
                    "email_verification_invalid",
                    "The email confirmation link is invalid or expired.",
                )
        if (!accounts.markEmailVerified(userId)) {
            throw ApiException(400, "email_verification_invalid", "The account is no longer available.")
        }
    }

    fun requestPasswordReset(email: String) {
        val user = accounts.findByEmail(email) ?: return
        if (!accounts.hasCredentialAccount(user.id)) return
        deliver(
            user = user,
            purpose = AuthTokenPurpose.PASSWORD_RESET,
            path = "/reset-password",
            subject = "Reset your Table Rhythm password",
            heading = "Reset your password",
            action = "Reset password",
            explanation = "Use this link within one hour to choose a new password.",
            note = "If you did not request a password reset, your password is unchanged and you can safely ignore this email.",
        )
    }

    fun resetPassword(token: String, password: String) {
        val userId =
            tokens.consumePasswordReset(token)
                ?: throw ApiException(
                    400,
                    "password_reset_invalid",
                    "The password reset link is invalid or expired.",
                )
        accounts.resetPassword(userId, password)
        sessions.revokeUser(userId)
    }

    private fun deliver(
        user: AccountUser,
        purpose: AuthTokenPurpose,
        path: String,
        subject: String,
        heading: String,
        action: String,
        explanation: String,
        note: String,
    ): AuthEmailDeliveryStatus {
        val token = tokens.issue(user.id, purpose) ?: return AuthEmailDeliveryStatus.THROTTLED
        val link = "${properties.publicOrigin.trimEnd('/')}$path#token=$token"
        val email =
            emailRenderer.render(
                BrandedEmailTemplate(
                    preheader = "$heading — Table Rhythm",
                    eyebrow = if (purpose == AuthTokenPurpose.EMAIL_VERIFICATION) "Welcome to the table" else "Account security",
                    heading = heading,
                    paragraphs = listOf(explanation),
                    actionLabel = action,
                    actionUrl = link,
                    note = note,
                ),
            )
        return runCatching {
            sender.send(
                recipient = user.email,
                subject = subject,
                html = email.html,
                text = email.text,
            )
        }.fold(
            onSuccess = { AuthEmailDeliveryStatus.SENT },
            onFailure = { error ->
                logger.error(
                    "Authentication email delivery failed purpose={} userId={} failureType={}",
                    purpose.value,
                    user.id,
                    error.javaClass.simpleName,
                )
                AuthEmailDeliveryStatus.FAILED
            },
        )
    }
}
