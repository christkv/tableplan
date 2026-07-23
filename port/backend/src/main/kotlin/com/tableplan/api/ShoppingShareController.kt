package com.tableplan.api

import com.tableplan.auth.TableplanPrincipal
import com.tableplan.sharing.ResolvedShare
import com.tableplan.sharing.ShoppingShareService
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.http.HttpHeaders
import org.springframework.http.ResponseCookie
import org.springframework.security.core.Authentication
import org.springframework.web.bind.annotation.CookieValue
import org.springframework.web.bind.annotation.DeleteMapping
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PatchMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RestController
import java.time.Duration

private const val SHARE_COOKIE = "TABLEPLAN_SHARE"

data class CreateShareRequest(val expiresInDays: Int = 14)

data class ExchangeShareRequest(val shareId: String, val token: String)

data class PublicToggleRequest(val checked: Boolean)

@RestController
class ShoppingShareController(
    private val shares: ShoppingShareService,
) {
    @PostMapping("/api/v1/shopping-lists/{listId}/shares")
    fun create(
        @PathVariable listId: String,
        @RequestBody request: CreateShareRequest,
        authentication: Authentication,
    ) = shares.create(authentication.principal(), listId, request.expiresInDays)

    @GetMapping("/api/v1/shopping-lists/{listId}/shares")
    fun list(@PathVariable listId: String, authentication: Authentication) =
        shares.list(authentication.principal(), listId)

    @DeleteMapping("/api/v1/shopping-lists/{listId}/shares/{shareId}")
    fun revoke(
        @PathVariable listId: String,
        @PathVariable shareId: String,
        authentication: Authentication,
    ) = mapOf("revoked" to shares.revoke(authentication.principal(), listId, shareId))

    @PostMapping("/api/public/shopping/exchange")
    fun exchange(
        @RequestBody request: ExchangeShareRequest,
        servletRequest: HttpServletRequest,
        response: HttpServletResponse,
    ) {
        val share =
            shares.resolve(request.token, request.shareId)
                ?: throw ApiException(401, "share_invalid", "Share link is invalid or expired.")
        response.addHeader(
            HttpHeaders.SET_COOKIE,
            ResponseCookie.from(SHARE_COOKIE, request.token)
                .httpOnly(true)
                .secure(servletRequest.isSecure)
                .sameSite("Lax")
                .path("/api/public/shopping")
                .maxAge(Duration.between(java.time.Instant.now(), share.expiresAt))
                .build()
                .toString(),
        )
    }

    @GetMapping("/api/public/shopping/{shareId}")
    fun publicList(
        @PathVariable shareId: String,
        @CookieValue(SHARE_COOKIE, required = false) token: String?,
    ) = shares.publicList(resolve(token, shareId))
        ?: throw ApiException(404, "shopping_list_not_found", "Shopping list not found.")

    @PatchMapping("/api/public/shopping/{shareId}/items/{itemId}")
    fun toggle(
        @PathVariable shareId: String,
        @PathVariable itemId: String,
        @CookieValue(SHARE_COOKIE, required = false) token: String?,
        @RequestBody request: PublicToggleRequest,
    ) = shares.toggle(resolve(token, shareId), itemId, request.checked)

    @PostMapping("/api/public/shopping/logout")
    fun logout(response: HttpServletResponse) {
        response.addHeader(
            HttpHeaders.SET_COOKIE,
            ResponseCookie.from(SHARE_COOKIE, "")
                .httpOnly(true)
                .sameSite("Lax")
                .path("/api/public/shopping")
                .maxAge(Duration.ZERO)
                .build()
                .toString(),
        )
    }

    private fun resolve(token: String?, shareId: String): ResolvedShare =
        token?.let { shares.resolve(it, shareId) }
            ?: throw ApiException(401, "share_authentication_required", "Share authentication is required.")
}

