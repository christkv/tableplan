package com.tableplan.auth

import com.tableplan.api.ApiException
import org.junit.jupiter.api.Test
import org.springframework.mock.web.MockHttpServletRequest
import kotlin.test.assertEquals

class GoogleOAuthSuccessHandlerTest {
    @Test
    fun `preserves safe application error codes`() {
        assertEquals(
            "oauth_email_unverified",
            oauthFailureCode(ApiException(403, "oauth_email_unverified", "Email is not verified.")),
        )
    }

    @Test
    fun `uses a generic code for unexpected failures`() {
        assertEquals("oauth_failed", oauthFailureCode(IllegalStateException("unexpected")))
        assertEquals(
            "oauth_failed",
            oauthFailureCode(ApiException(500, "unsafe code", "Unexpected failure.")),
        )
    }

    @Test
    fun `returns to the validated relative page after oauth`() {
        val request =
            MockHttpServletRequest().apply {
                requireNotNull(getSession(true))
                    .setAttribute(OAUTH_RETURN_TO_ATTRIBUTE, "/plan?week=2026-07-20")
            }

        assertEquals("/plan?week=2026-07-20", oauthSuccessLocation(request))
        assertEquals(null, request.getSession(false)?.getAttribute(OAUTH_RETURN_TO_ATTRIBUTE))
    }
}
