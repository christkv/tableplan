package com.tableplan.config

import org.springframework.boot.ApplicationArguments
import org.springframework.boot.ApplicationRunner
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.core.env.Environment
import org.springframework.stereotype.Component
import java.net.URI

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class ProductionAuthConfigurationValidator(
    private val environment: Environment,
    private val properties: TableplanProperties,
) : ApplicationRunner {
    override fun run(args: ApplicationArguments) {
        validateProductionAuthConfiguration(
            production = environment.activeProfiles.contains("prod"),
            publicOrigin = properties.publicOrigin,
            sessionCookieSecure = properties.auth.sessionCookieSecure,
            googleClientId =
                environment.getProperty(
                    "spring.security.oauth2.client.registration.google.client-id",
                ),
            googleRedirectUri =
                environment.getProperty(
                    "spring.security.oauth2.client.registration.google.redirect-uri",
                ),
        )
    }
}

internal fun validateProductionAuthConfiguration(
    production: Boolean,
    publicOrigin: String,
    sessionCookieSecure: Boolean,
    googleClientId: String?,
    googleRedirectUri: String?,
) {
    if (!production) return
    val origin =
        runCatching { URI.create(publicOrigin.trimEnd('/')) }
            .getOrElse { throw IllegalStateException("TABLEPLAN_PUBLIC_ORIGIN must be a valid HTTPS origin.") }
    check(
        origin.scheme == "https" &&
            !origin.host.isNullOrBlank() &&
            origin.userInfo == null &&
            origin.query == null &&
            origin.fragment == null &&
            (origin.path.isNullOrEmpty() || origin.path == "/"),
    ) {
        "TABLEPLAN_PUBLIC_ORIGIN must be an HTTPS origin without a path, query, or fragment in prod."
    }
    check(sessionCookieSecure) {
        "TABLEPLAN_SESSION_COOKIE_SECURE must be true in prod."
    }
    if (!googleClientId.isNullOrBlank()) {
        val expected = "${publicOrigin.trimEnd('/')}/login/oauth2/code/google"
        check(googleRedirectUri == expected) {
            "The Google redirect URI must exactly match $expected in prod."
        }
    }
}
