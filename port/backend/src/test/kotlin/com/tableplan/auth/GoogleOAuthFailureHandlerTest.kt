package com.tableplan.auth

import org.junit.jupiter.api.Test
import org.springframework.security.authentication.BadCredentialsException
import org.springframework.security.oauth2.core.OAuth2AuthenticationException
import org.springframework.security.oauth2.core.OAuth2Error
import kotlin.test.assertEquals

class GoogleOAuthFailureHandlerTest {
    @Test
    fun `maps safe provider failures to frontend error codes`() {
        assertEquals(
            "access_denied",
            oauthAuthenticationFailureCode(OAuth2AuthenticationException(OAuth2Error("access_denied"))),
        )
        assertEquals(
            "state_mismatch",
            oauthAuthenticationFailureCode(
                OAuth2AuthenticationException(OAuth2Error("authorization_request_not_found")),
            ),
        )
        assertEquals(
            "state_mismatch",
            oauthAuthenticationFailureCode(
                OAuth2AuthenticationException(OAuth2Error("invalid_state_parameter")),
            ),
        )
        assertEquals(
            "invalid_code",
            oauthAuthenticationFailureCode(OAuth2AuthenticationException(OAuth2Error("invalid_grant"))),
        )
        assertEquals(
            "oauth_failed",
            oauthAuthenticationFailureCode(BadCredentialsException("hidden")),
        )
    }
}
