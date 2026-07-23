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
    fun `allows a return origin on the same host with a different development port`() {
        assertEquals(
            "http://localhost:5173",
            validatedOAuthReturnOrigin("http://localhost:5173", "http", "localhost"),
        )
    }

    @Test
    fun `rejects unsafe oauth return origins`() {
        assertNull(validatedOAuthReturnOrigin("https://localhost:5173", "http", "localhost"))
        assertNull(validatedOAuthReturnOrigin("http://example.com:5173", "http", "localhost"))
        assertNull(validatedOAuthReturnOrigin("http://user@localhost:5173", "http", "localhost"))
        assertNull(validatedOAuthReturnOrigin("http://localhost:5173/untrusted", "http", "localhost"))
    }
}
