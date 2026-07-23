package com.tableplan.auth

import jakarta.servlet.http.Cookie
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import jakarta.validation.Valid
import jakarta.validation.constraints.Email
import jakarta.validation.constraints.NotBlank
import jakarta.validation.constraints.Size
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseCookie
import org.springframework.security.core.Authentication
import org.springframework.security.web.csrf.CsrfToken
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.time.Duration

const val SESSION_COOKIE = "TABLEPLAN_SESSION"

data class RegisterRequest(
    @field:NotBlank @field:Size(max = 100) val name: String,
    @field:Email @field:Size(max = 254) val email: String,
    @field:NotBlank @field:Size(min = 3, max = 32) val username: String,
    @field:Size(min = 12, max = 200) val password: String,
)

data class LoginRequest(
    @field:NotBlank @field:Size(max = 254) val identifier: String,
    @field:NotBlank @field:Size(max = 200) val password: String,
)

data class SessionResponse(
    val user: UserResponse,
    val householdId: String,
)

data class SwitchHouseholdRequest(@field:NotBlank val householdId: String)

data class UserResponse(
    val id: String,
    val name: String,
    val email: String,
    val username: String,
)

@RestController
@RequestMapping("/api/auth")
class AuthController(
    private val accounts: AccountService,
    private val sessions: SessionRepository,
) {
    @GetMapping("/csrf")
    fun csrf(token: CsrfToken) = mapOf("headerName" to token.headerName, "token" to token.token)

    @PostMapping("/register")
    fun register(
        @Valid @RequestBody body: RegisterRequest,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): SessionResponse {
        val user = accounts.register(body.name, body.email, body.username, body.password)
        val session = sessions.create(user.id, user.householdId)
        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookie(session, request.isSecure).toString())
        return user.toSessionResponse()
    }

    @PostMapping("/login")
    fun login(
        @Valid @RequestBody body: LoginRequest,
        request: HttpServletRequest,
        response: HttpServletResponse,
    ): SessionResponse {
        val user = accounts.authenticate(body.identifier, body.password)
        val session = sessions.create(user.id, user.householdId)
        response.addHeader(HttpHeaders.SET_COOKIE, sessionCookie(session, request.isSecure).toString())
        return user.toSessionResponse()
    }

    @PostMapping("/logout")
    fun logout(request: HttpServletRequest, response: HttpServletResponse) {
        request.cookies?.firstOrNull { it.name == SESSION_COOKIE }?.value?.let(sessions::revoke)
        response.addHeader(
            HttpHeaders.SET_COOKIE,
            ResponseCookie.from(SESSION_COOKIE, "")
                .httpOnly(true)
                .secure(request.isSecure)
                .sameSite("Lax")
                .path("/")
                .maxAge(Duration.ZERO)
                .build()
                .toString(),
        )
    }

    @GetMapping("/session")
    fun session(authentication: Authentication?): SessionResponse? {
        val principal = authentication?.principal as? TableplanPrincipal ?: return null
        val user = accounts.find(principal.userId) ?: return null
        return user.toSessionResponse()
    }

    @PostMapping("/switch-household")
    fun switchHousehold(
        @Valid @RequestBody body: SwitchHouseholdRequest,
        authentication: Authentication,
        request: HttpServletRequest,
    ): SessionResponse {
        val principal = authentication.principal as? TableplanPrincipal
            ?: throw com.tableplan.api.ApiException(401, "authentication_required", "Authentication is required.")
        if (!accounts.canAccessHousehold(principal.userId, body.householdId)) {
            throw com.tableplan.api.ApiException(403, "household_access_denied", "Household access denied.")
        }
        val token = request.cookies?.firstOrNull { it.name == SESSION_COOKIE }?.value
            ?: throw com.tableplan.api.ApiException(401, "session_required", "A browser session is required.")
        if (!sessions.switchHousehold(token, principal.userId, body.householdId)) {
            throw com.tableplan.api.ApiException(409, "session_changed", "The session changed. Sign in again.")
        }
        accounts.setDefaultHousehold(principal.userId, body.householdId)
        val user = accounts.find(principal.userId)
            ?: throw com.tableplan.api.ApiException(404, "user_not_found", "User not found.")
        return user.copy(householdId = body.householdId).toSessionResponse()
    }

    private fun sessionCookie(session: CreatedSession, secure: Boolean): ResponseCookie =
        ResponseCookie.from(SESSION_COOKIE, session.token)
            .httpOnly(true)
            .secure(secure)
            .sameSite("Lax")
            .path("/")
            .maxAge(Duration.between(java.time.Instant.now(), session.expiresAt))
            .build()

    private fun AccountUser.toSessionResponse() =
        SessionResponse(UserResponse(id, name, email, username), householdId)
}
