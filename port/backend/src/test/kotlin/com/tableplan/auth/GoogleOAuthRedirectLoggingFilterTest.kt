package com.tableplan.auth

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class GoogleOAuthRedirectLoggingFilterTest {
    @Test
    fun `extracts only the decoded redirect uri from the google location`() {
        val location =
            "https://accounts.google.com/o/oauth2/v2/auth" +
                "?client_id=client-id.apps.googleusercontent.com" +
                "&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Flogin%2Foauth2%2Fcode%2Fgoogle" +
                "&scope=openid"

        assertEquals(
            "http://localhost:5173/login/oauth2/code/google",
            extractGoogleRedirectUri(location),
        )
    }

    @Test
    fun `returns null when the authorization location has no redirect uri`() {
        assertNull(extractGoogleRedirectUri(null))
        assertNull(extractGoogleRedirectUri("https://accounts.google.com/o/oauth2/v2/auth?scope=openid"))
    }

    @Test
    fun `allows a relative oauth return path`() {
        assertEquals("/plan?week=2026-07-20", validatedOAuthReturnTo("/plan?week=2026-07-20"))
    }

    @Test
    fun `replaces unsafe oauth return paths with the default`() {
        assertEquals(DEFAULT_OAUTH_RETURN_TO, validatedOAuthReturnTo(null))
        assertEquals(DEFAULT_OAUTH_RETURN_TO, validatedOAuthReturnTo("https://example.com/recipes"))
        assertEquals(DEFAULT_OAUTH_RETURN_TO, validatedOAuthReturnTo("//example.com/recipes"))
        assertEquals(DEFAULT_OAUTH_RETURN_TO, validatedOAuthReturnTo("/recipes#fragment"))
        assertEquals(DEFAULT_OAUTH_RETURN_TO, validatedOAuthReturnTo("/recipes\r\nLocation: https://example.com"))
    }
}
